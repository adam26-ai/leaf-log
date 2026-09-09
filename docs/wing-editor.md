# Wing editor

Settings includes a Wings card directly beneath Profile. It lists the signed-in pilot's exact stored wing names and flight counts, including unspecified wings. Select one name to rename it or multiple names to merge them, then enter the final name (existing names are suggested).

One selected wing uses blue Rename prefixes, a Rename wing to label, and a Rename Wing button. Multiple selections switch to deep emergency-orange Merge prefixes, checkmarks, label and Merge Wings button. The warning uses deep orange on a light orange background, previews how many entries will change, and identifies a merge into an existing name. Saving is explicit; typing, selecting, pressing Enter in the name field and Cancel do not save. Wing controls are isolated from the surrounding profile form's autosave behavior.

Saving updates only `Flight.glider` for the authenticated owner and the selected exact source names, in one transaction. It preserves notes, flight data, scores and privacy. Source counts are rechecked before updating; stale selections or concurrent transaction conflicts prompt a refreshed review rather than a partial update. Destination names are trimmed, required, single-line and limited to 200 characters, matching the individual flight editor.

No separate wing registry or upload alias is created. Subsequent uploads continue to use the name recorded in their IGC file and may introduce an old spelling again. Existing original IGC bytes are preserved. Renaming does not trigger metric or XC recalculation.

Validation covers authentication/input rejection, owner isolation, merging into an existing name, unspecified wings, stale-count rollback, preservation of other flight fields, explicit Save versus profile autosave, and Cancel. Browser checks use temporary flights to verify mobile/desktop layouts, merge and rename persistence, and refreshed logbook filters.
