# Sites in Leaf Log

A site is a reusable place. It can start with just a name and gain a map pin and boundary later. Every site uses the same full editor.

| What you see | What it means |
| --- | --- |
| **Mapped** | The site has a name and a map pin. A boundary is optional. |
| **Name only** | The site has a name but no established location or flight GPS evidence. |
| **Location needs review** | Coordinates or possible matches exist, but the intended place is uncertain. |
| **Site not identified · GPS available** | The flight has coordinates but no identified site. |
| **Site not recorded** | Neither a site nor a geographic position was recorded. |

Private and Public describe visibility, independently of whether a site is mapped. Public sites require a map pin. Takeoff and Landing describe how a site is used.

## Edit a site from any starting point

Open a flight’s site name, then choose **Edit this site**. You can also open **Settings → Sites → Edit site**, or **Edit site** inside a manual entry or CSV review.

The editor always includes:

- Name, use for takeoff/landing, and visibility.
- Place search and tools to place or move a pin.
- Latitude and longitude fields.
- Tools to draw, adjust, and remove a boundary.
- Save and Cancel.

For a flight with recorded coordinates, **Use this flight’s position** can place the site pin there. A name-only site has all these tools too; adding a location does not require creating a replacement site.

A saved boundary must contain the site pin. You can change both together and save once. Invalid details or a conflicting edit in another tab leave the whole edit unsaved.

On a saved flight or in Settings, **Save site** saves the complete site immediately. Within an unsaved manual entry or CSV review, **Done** keeps a pending site draft. The site is saved only when the flight is saved or the import is confirmed. Canceling the enclosing entry or import creates nothing.

## Site location and flight position are different facts

The **site pin** is the representative location of a place. The **flight position** is the coordinate recorded or entered for that particular takeoff or landing.

Selecting or editing a site never copies its pin into missing flight coordinates. Editing a flight coordinate does not silently remove its site selection. If a selected site and flight position disagree, the selection remains and the location needs review.

A flight without takeoff coordinates can display its selected site’s map with **“Site location; takeoff position not recorded.”** That pin is not presented as a recorded takeoff.

Changing a site’s name or location affects how all flights using that site display the place. Their recorded positions remain unchanged. **Remove site from this flight** clears that flight’s selection while retaining its coordinates and the reusable site.

## Manual entries and CSV imports

Enter a new site name, select an existing site, or open the full editor. A name alone creates a private unmapped site. A name with usable coordinates normally creates a private mapped site, or reuses a matching existing site.

In CSV column matching, specify whether coordinates describe **this flight’s position** or **the site’s reference location**. Reference coordinates can establish a site pin without becoming recorded flight positions.

The import preview describes the proposed sites. It writes no sites or flights. New sites remain private even when imported flights are public; importing does not publish locations.

Repeated names are checked geographically. New takeoff groups have a maximum diameter of 150 m; landing groups have a maximum diameter of 300 m. Widely separated namesakes and rows without coordinates remain separate. A group’s pin uses an actual supplied coordinate. Overlapping existing sites or disagreeing names produce a review message instead of a guess.

When explicitly selecting an unmapped site, coherent flight coordinates can add a pin to that same site. Conflicting positions already associated with it prevent automatic enrichment; choose its intended pin in the editor.

CSV location text and coordinates are retained as original evidence. Changing a site selection does not erase that evidence. Exports include site pins separately from flight positions and include location provenance.

## Public and private sites

Private sites are visible only to their owner. Public sites can be discovered and reused by other pilots. Sharing a site does not share the flights that use it.

Signed-in pilots with a profile can edit a public site’s name, pin, boundary, and use for takeoff/landing. The editor explains that these changes are shared. Only the owner can change visibility. A public site must remain public when other pilots use it or have contributed to it.

## Automatic recording detection

Web uploads and device uploads use the same conservative geographic matching. A single matching visible site can be selected automatically. More than one plausible site requires review. Coordinates alone do not produce an invented site name.

Without a boundary, matching uses 600 m around a takeoff pin and 900 m around a landing pin. A boundary replaces the default circle. These matching distances are distinct from the stricter grouping limits used when importing new sites.

Attaching an IGC recording to an existing entry keeps an explicitly chosen site. The recorded endpoints replace the entry’s reported flight positions; a disagreement with the selected site is shown for review.

## Manage existing flights and undo imports

Settings → Sites lists your sites and public sites used in your logbook. **Flights at this site** lists flights using the selected site. **Review matching flights** finds additional endpoint candidates for explicit selection. It does not reassign history automatically.

The logbook has separate takeoff and landing site filters. The site-location filter can find missing or uncertain locations at either endpoint.

Undo import removes untouched imported entries. It also removes private sites created by that import when they remain unchanged and unused. Sites that were subsequently edited, shared, or reused are retained.

Historical entries that predate this model can already open the full editor. A separate conversion tool supports previewing and converting historical names in batches; it preserves existing site selections and recorded coordinates.
