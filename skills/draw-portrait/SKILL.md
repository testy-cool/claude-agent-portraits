---
name: draw-portrait
description: Use when the user asks to draw, make, generate or redraw an agent portrait, character or face for the agent-portrait plugin, from a description of the agent's job, an art direction or a photo of a person, or to add a second take of an existing set.
---

# Draw a portrait set

The script is `scripts/draw-portrait` in this plugin, two folders up from this
skill's base directory. Run it from the user's project folder. It has an image
model draw all 30 frames on one sheet, cuts them up, writes the set to
`.claude/agent-portrait/emotes/<name>/` and selects it for that project. A run
takes one to two minutes.

```bash
<plugin>/scripts/draw-portrait --name forge --role "a deploy agent" \
  --direction "a grizzled dwarf blacksmith with a braided red beard"
```

- `--name`: the set's folder name, lowercase.
- `--role`: what the agent does, in a few words. It decides the props.
- `--direction`: how the character looks. Ask the user if they gave no look.
- `--photo me.png`: draw someone who looks like the person in the photo.
  Only with a photo the user supplied of themselves or someone who agreed.
- `--variant 2`: add a second drawing of every frame to an existing set, so
  states do not repeat the same gesture.
- `--backend codex` or `--backend azure`: picked by itself when unset.

It needs Python 3 with Pillow and NumPy. The codex backend needs the Codex CLI
logged in. The azure backend needs `AZURE_IMAGE_ENDPOINT`, `AZURE_IMAGE_KEY`
and `AZURE_IMAGE_MODEL`. If neither is available, tell the user which one to
set up instead of trying other image tools.

When it finishes, it prints the path of the sheet it drew. Show the user that
sheet with the Read tool, then tell them to run `/portrait <name>` to see it
above the prompt.
