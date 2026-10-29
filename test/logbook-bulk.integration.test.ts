// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { saveBulkEdits, listEditorFlights } from "@/lib/logbook/bulk-edit";
import { METRICS_VERSION } from "@/lib/flights/analysis-state";

const owners:string[]=[];
beforeAll(async()=>{for(let i=0;i<2;i++){const handle=`bulk${randomUUID().replaceAll("-","").slice(0,12)}`;const user=await prisma.user.create({data:{email:`${handle}@test.local`,profile:{create:{handle,displayName:"Bulk test"}}}});owners.push(user.id);}});
afterAll(async()=>{await prisma.site.deleteMany({where:{ownerId:{in:owners}}});await prisma.user.deleteMany({where:{id:{in:owners}}});await prisma.$disconnect();});
const create=(ownerId=owners[0],patch={})=>prisma.flight.create({data:{ownerId,recordingKind:"logbook",source:"manual_entry",status:"ready",metricsVersion:METRICS_VERSION,flightDate:new Date("2026-10-01"),durationS:3600,glider:"Original wing",...patch}});
const change=(flight:{id:string;updatedAt:Date},values:Record<string,string>)=>({id:flight.id,expectedUpdatedAt:flight.updatedAt.toISOString(),values});

it("saves different edits and deletions atomically, keeps IGC measurements, and returns only owner data",async()=>{
  const manual=await create(),recorded=await create(owners[0],{recordingKind:"igc",source:"web_upload",maxAltM:2300}),removed=await create(),other=await create(owners[1]);
  await saveBulkEdits(owners[0],{changes:[change(manual,{notes:"A note",durationMinutes:"92",visibility:"friends"}),change(recorded,{glider:"New wing"}),{id:removed.id,expectedUpdatedAt:removed.updatedAt.toISOString(),delete:true}]});
  expect(await prisma.flight.findUniqueOrThrow({where:{id:manual.id}})).toMatchObject({notes:"A note",durationS:5520,visibility:"friends"});
  expect(await prisma.flight.findUniqueOrThrow({where:{id:recorded.id}})).toMatchObject({glider:"New wing",maxAltM:2300});
  expect(await prisma.flight.findUnique({where:{id:removed.id}})).toBeNull();
  expect((await listEditorFlights(owners[0])).some(row=>row.id===other.id)).toBe(false);
});

it("rejects another pilot's flight, stale edits/deletes, unknown fields, and recorded metric writes without partial saves",async()=>{
  const first=await create(),stale=await create(),foreign=await create(owners[1]),recorded=await create(owners[0],{recordingKind:"igc"});
  await prisma.flight.update({where:{id:stale.id},data:{notes:"Concurrent note"}});
  for(const invalid of [change(foreign,{notes:"Unauthorized"}),{id:stale.id,expectedUpdatedAt:stale.updatedAt.toISOString(),delete:true},change(recorded,{maxAltitude:"3000"}),change(first,{ownerId:owners[1]})]){
    await expect(saveBulkEdits(owners[0],{changes:[change(first,{glider:"Should roll back"}),invalid]})).rejects.toThrow();
    expect((await prisma.flight.findUniqueOrThrow({where:{id:first.id}})).glider).toBe("Original wing");
  }
  expect((await prisma.flight.findUniqueOrThrow({where:{id:foreign.id}})).notes).toBeNull();
  expect((await prisma.flight.findUniqueOrThrow({where:{id:stale.id}})).notes).toBe("Concurrent note");
});

it("validates site access, stores private names without public caches, and clears stale zone assignments",async()=>{
  const site=await prisma.site.create({data:{ownerId:owners[0],name:"Private takeoff",normalizedName:"private takeoff",visibility:"private"}});
  const hidden=await prisma.site.create({data:{ownerId:owners[1],name:"Other pilot private",normalizedName:"other pilot private",visibility:"private"}});
  const flight=await create();
  await expect(saveBulkEdits(owners[0],{changes:[change(flight,{takeoffSite:`site:${hidden.id}`})]})).rejects.toThrow();
  await saveBulkEdits(owners[0],{changes:[change(flight,{takeoffSite:`site:${site.id}`,landingSite:"name:Landing field"})]});
  expect(await prisma.flight.findUniqueOrThrow({where:{id:flight.id}})).toMatchObject({takeoffSiteId:site.id,takeoffSiteName:null,takeoffZoneId:null,takeoffSiteAssignment:"user_selected",landingSiteName:"Landing field",landingSiteAssignment:"custom_name"});
  const own=(await listEditorFlights(owners[0])).find(row=>row.id===flight.id)!;
  expect(own.list.takeoffSiteName).toBe("Private takeoff");
  expect(own.values.takeoffSite).toBe(`site:${site.id}`);
});

it("preserves tandem rules and requires an accepted friendship for instructor assignment",async()=>{
  const flight=await create();
  await expect(saveBulkEdits(owners[0],{changes:[change(flight,{instructorId:owners[1]})]})).rejects.toThrow();
  await prisma.friendship.create({data:{requesterId:owners[0],addresseeId:owners[1],status:"accepted"}});
  await saveBulkEdits(owners[0],{changes:[change(flight,{flightTypes:"siv;tandem;tow",instructorId:owners[1]})]});
  expect(await prisma.flight.findUniqueOrThrow({where:{id:flight.id}})).toMatchObject({flightFlags:["siv","tandem","tow"],occupancy:"tandem",tandemOverride:true,launchTypes:["ST"],instructorId:owners[1]});
});
