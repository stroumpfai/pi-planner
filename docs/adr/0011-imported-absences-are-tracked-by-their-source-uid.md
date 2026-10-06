# Imported absences are tracked by their source UID

An absence imported from an `.ics` file keeps the `UID` of the calendar event it came from in a
new nullable column, `absences.source_uid`, unique per member. Importing the same calendar again
is an **upsert** on `(member_id, source_uid)`: a moved event updates the row it created, an
unchanged one writes nothing, and an imported row whose event has left the file is proposed for
removal. Absences entered by hand have no `source_uid` and an import never touches them. The
full design is in `spec/teams.md` §7.4.1.

## Why

People export their leave from Outlook or Google again and again, because leave changes. A
second import of an updated file has to recognise what the first one wrote. Otherwise every
re-import piles a new copy on top of the old one, and a vacation moved by a week shows up twice.
The event's `UID` is the only key that stays put when everything else about an event changes,
and every calendar application writes one.

## Considered options

**Merge, skipping exact duplicates**, as the holiday import does (same dates, halves and label).
No schema change. Rejected: a holiday doesn't move, but leave does, and a moved vacation would
leave its old dates behind as a ghost absence that keeps lowering capacity.

**Replace a window**, as `bulk_create_absences` does. Rejected for files: an Outlook export
holds only what is in that calendar, so replacing the window would delete absences entered by
hand in the Absences view, or imported for the same person from another source.

**A per-occurrence exception list**, so that a weekly series with `EXDATE` or a moved occurrence
(`RECURRENCE-ID`) could be imported faithfully. Rejected for the reasons in `spec/teams.md` §3.4:
it would be a second scheduling model inside the first. Such events are skipped, with the
reason shown.

## Consequences

- **`source_uid` is provenance, not a lock.** An imported absence can be edited by hand like any
  other. The next import of the same event overwrites that edit, and the preview shows it as an
  *update*, with the rule it replaces beside the new one. If this turns out to bother people, an
  "edited since import" marker could untick those rows by default.
- **One event can be several rows.** A weekly rule over two weekdays becomes one rule per
  weekday, and a yearly rule one range per year. Their keys are suffixed (`UID#MO`, `UID#2027`)
  so each one is still stable from one export to the next. An event naming several members is
  one row per member under the same key, which is why the key includes the member.
- **Removals are fenced** by the import window and by the members the import involves, so a
  three-month export, or one person's file, can't delete anything outside what it covers.
- **The bulk window replacement still deletes imported rows** anchored in its window, as it
  deletes everything else there. The two bulk paths are not meant for the same member and window.
- **The team JSON export carries `source_uid`**, so a restored team still recognises its events.
  Older exports import with no `source_uid`, as hand-entered rows.
- The migration adds the column with a partial unique index (`WHERE source_uid IS NOT NULL`)
  and back-fills nothing: every existing absence was entered by hand.
