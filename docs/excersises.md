### Exercises

----

Each exercise **file is one practice set** — the **exercise picker** (click
the button showing the current set / "Free Play") lists whole files (loaded
from `public/exercises/**/*.yaml`, including subfolders), not the individual
exercises inside them. Sets are grouped in the picker by the subfolder they
live in — e.g. everything under `public/exercises/scales/` appears grouped
under a "scales" heading. Pick a set to switch the fretboard into practice
mode: the relevant section of the neck stays lit, everything else dims,
each correctly played note turns **green** and stays that way for the rest
of the exercise, and a wrong note flashes **red** for a moment.

Once you complete an exercise, the set automatically advances to the next
one after a moment — you never pick individual exercises yourself. The
file's top-level `ordered` key decides the order they're presented in: `true`
walks through them in the order listed in the file, `false` shuffles them
into a random order each time you start the set. When the last exercise is
done, a green checkmark appears next to the set's name; the ↻ button in the
panel's corner restarts the current exercise (or the whole set, once it's
done) without any layout shift. Pick **Free Play** in the picker to go back
to the plain live pitch display at any point.

Use **Import Exercise Set…** to load your own `.yaml`/`.yml` file from
disk as a new set — it's parsed entirely in the browser (nothing is
uploaded anywhere) and saved to the browser's `localStorage`, so it's still
there next time you open the app. Uploaded sets appear grouped under an
"Uploaded Exercises" heading in the picker, always listed last.

## Exercise file format

```yaml
bassbuddy:
  name: Bass Basics     # set's display name (shown in the Exercise Set dropdown); defaults to the file name if omitted
  ordered: false        # whole-set order: shuffle these exercises each run
  exercises:
    - name: Exercise One
      description: Description what to do
      ordered: true      # this exercise's own notes: play in this exact sequence
      fretboard:
        start: 1         # relevant section: an inclusive fret range...
        end: 5
      notes: [A, C#, F]
    - name: Exercise Two
      ordered: true
      fretboard:
        frets: [1, 2, 3, 7, 8, 9]   # ...or an explicit list of frets
      notes: [F, A, C#]
    - name: Ear Training Example
      mode: hear           # play the notes as audio instead of showing them
      ordered: true
      notes: [E, G, B]
    - name: Random Notes Example
      description: "First note: {{note}}"   # {{note}} is replaced with this attempt's actual first random note
      ordered: true
      randomNotes: 10       # 10 fresh random notes every attempt, drawn from the full chromatic scale
      fretboard:
        start: 0
        end: 4
    - name: Specific Octave Example
      ordered: true
      notes: [G2, A2, C3]   # a trailing octave number pins that exact octave instead of matching any octave
    - name: Scoring Example
      description: Play as many correct notes as you can before 3 mistakes
      notes: [A, C#, F]
      success_on: 15          # completes the instant 15 correct notes have been played
      failure_on: 3            # ...or ends early the instant 3 wrong notes have been played, whichever comes first
      accept_duplicates: false # each note (per exact octave) only scores once; see below
```

The `ordered` key means something different at each level:

- **Top-level** (`bassbuddy.ordered`): whether the set's exercises are worked
  through in the order they're listed in the file (`true`) or in a random
  order each time the set is started (`false`).
- **Per-exercise** (`exercises[].ordered`, defaults to `true` if omitted):
  whether that exercise's own `notes` must be played in the listed sequence
  (`true`), or just all hit in any order (`false`; repeats in `notes` need
  to be played that many times).

Other notes:

- `notes` are pitch classes (`C`, `C#`, `D`, … — flats like `Db` also work) by default, not tied to a specific octave or string; any occurrence of that pitch class on the neck counts. Append a (optionally negative) integer to pin one exact octave instead, e.g. `G2` — only that specific octave counts as correct then, using the same octave numbering the tuner/fretboard show (open G string is `G2`, open E string is `E1`). Entries can be mixed freely, e.g. `notes: [G2, A]`.
- `fretboard` is optional; omit it to treat the whole neck as relevant.
- `mode` (defaults to `see`): set to `hear` for "play what you hear" ear-training — instead of a "Next: X" text hint, the notes are played back using real recorded bass audio (sliced from `public/resources/*.m4a`, one take per string) automatically when the exercise starts, restarts, or is reached by auto-advance. A **▶ Replay** button appears in the panel to hear it again at any time. A bare pitch class (no octave pinned) always plays from octave 2 for consistency between notes in the sequence; a pinned octave (e.g. `G2`) plays that exact octave's real recording instead.
- `randomNotes: N` can be used instead of (or alongside) `notes` — the app draws `N` fresh random notes every time the exercise starts or restarts, taken from `notes` as the pool if given, or the full chromatic scale otherwise. One exercise can then cover a whole fretboard zone indefinitely (restart for a new random set) instead of needing several fixed-note exercises just for variety. Since the actual sequence is only known once it's drawn, `{{note}}` in `description` is replaced with that attempt's real first note (e.g. so a description can say "starting on {{note}}").
- `success_on: N` and/or `failure_on: N` put an exercise into a free-play **scoring mode** instead of a fixed sequence: play any note from the `notes` pool in any order, any number of times — a matching note scores a success point, anything else scores a failure point, and the exercise ends the instant either count hits its target (whichever happens first, if both are set). Setting either key switches to this mode regardless of the exercise's own `ordered` value.
  - `accept_duplicates` (defaults to `true`, only meaningful alongside `success_on`/`failure_on`): `true` keeps the default unlimited-repeats behavior above. `false` means a note only scores the first time it's played in that exact octave — playing the same pitch class in a *different* octave still scores, but only if that octave is actually reachable within the exercise's `fretboard` window (or anywhere on the neck if it doesn't set one); an unreachable octave gives no point (and isn't counted as a mistake either). Useful for forcing a player through every distinct playable position of a fretboard zone instead of repeating one spot.

To add a built-in exercise file, drop a `.yaml`/`.yml` file anywhere under
`public/exercises/` (subfolders are fine and become groups in the picker)
and restart `npm run dev` (or rerun `npm run build`) — a `pre*` npm hook
regenerates `public/exercises/manifest.json`, which is how the app
discovers files in that folder tree. Run `npm run exercises:manifest` to
regenerate it without a full dev/build cycle (e.g. while the dev server is
already running).
