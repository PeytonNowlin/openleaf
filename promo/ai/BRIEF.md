# Generated wrapper shots (Higgsfield)

Two clips, and only two: the product shots are real screen captures, so nothing
generated has to depict the editor. These are the cinematic bookends.

File names matter — `assemble.mjs` sorts `ai/` and `shots/` together by name:

| File to save as         | Length | Where it lands            |
|-------------------------|--------|---------------------------|
| `ai/00-cold-open.mp4`   | 4-5s   | before the title card     |
| `ai/08-outro-broll.mp4` | 4-5s   | after the npm-install card |

Both must be 16:9. Anything else gets letterboxed onto `#0b0f14` at assembly.

## Prompt 1 — cold open

> Extreme macro, cinematic: a single young leaf unfurling in near-darkness, wet
> edges catching one soft rim light from the left, deep green against a
> near-black background, shallow depth of field, slow push in, dust motes
> drifting, no text, no people, no logos, 16:9, film grain, colour graded cool
> shadows with a warm green highlight.

## Prompt 2 — outro b-roll

> Extreme macro, cinematic: dark green leaves settling to stillness after a
> breeze, a single drop of water falling and holding on a leaf tip, near-black
> background, one soft rim light, slow drift upward, no text, no people, no
> logos, 16:9, film grain, matching cool shadows and warm green highlight.

Deliberately abstract and text-free: generated video renders lettering
unreliably, and every word in this cut is real HTML rendered by the browser.

## Commands

```sh
hf auth login                       # browser OAuth, once
npx skills add higgsfield-ai/skills # optional: the companion skills pack
hf model list --video               # pick a model id from this list
hf model get <model_id>             # confirm which params it accepts
hf generate create <model_id> --prompt "<prompt 1>" --wait --wait-timeout 20m
```

`--wait` prints the result URL. Save it into place and rebuild:

```sh
curl -L -o ai/00-cold-open.mp4 "<url>"
node assemble.mjs
```

Check the price before committing to a model:

```sh
hf generate cost <model_id> --prompt "<prompt 1>"
```

## If the grade does not match

The captures are graded around `#0b0f14` with a `#2f7d32` / `#7ee787` green.
If a generated clip comes back warmer or brighter, correct it at normalize time
rather than regenerating — add to that clip's `-vf` chain in `assemble.mjs`:

```
eq=saturation=0.9:gamma=0.95,colorbalance=bs=0.04:gm=0.03
```
