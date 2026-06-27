import { describe, it, expect } from "vitest";
import sharp from "sharp";
import { processAvatar, AvatarError } from "./process";

async function makeJpeg(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: "#4a7c3a" },
  })
    .jpeg()
    .toBuffer();
}

describe("processAvatar", () => {
  it("center-crops a non-square image to 512 and 128 squares", async () => {
    const { image, thumb } = await processAvatar(
      await makeJpeg(900, 300),
      "image/jpeg",
      "wide.jpg",
    );
    const full = await sharp(image).metadata();
    const small = await sharp(thumb).metadata();
    expect([full.width, full.height]).toEqual([512, 512]);
    expect([small.width, small.height]).toEqual([128, 128]);
    expect(full.format).toBe("jpeg");
  });

  it("strips metadata (no EXIF in the output)", async () => {
    const { image } = await processAvatar(
      await makeJpeg(600, 600),
      "image/jpeg",
      "sq.jpg",
    );
    expect((await sharp(image).metadata()).exif).toBeUndefined();
  });

  it("rejects empty input", async () => {
    await expect(processAvatar(Buffer.alloc(0), "image/jpeg", "x.jpg")).rejects.toBeInstanceOf(
      AvatarError,
    );
  });

  it("rejects undecodable input", async () => {
    await expect(
      processAvatar(Buffer.from("not an image"), "image/jpeg", "x.jpg"),
    ).rejects.toBeInstanceOf(AvatarError);
  });
});
