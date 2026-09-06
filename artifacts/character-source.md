# Lobby character sheet

Source: `character-source.png`, generated with the built-in image generation tool.

Prompt summary: a role-neutral 4×8 character sheet for the KILLER game, 32 distinct adult chest-up pixel-art portraits, balanced 16 male and 16 female presentations. The cast is primarily Southeast, East, and South Asian, with varied ages, complexions, face shapes, hairstyles, glasses, and muted clothing. All tiles use the same dark teal background, acid-green and restrained red rim light, and exclude text, weapons, uniforms, badges, and props.

`scripts/prepare-character-assets.cjs` crops the sheet in row-major catalog order and emits the 256×256 WebP files used at runtime.

## Japanese young-adult expansion

`character-sources/` contains twelve individual source images generated with the built-in image tool for: Sota, Hina, Riku, Mei, Kaito, Akira, Takumi, Nana, Yuto, Sakura, Daichi, and Misaki. Each prompt requested one role-neutral Japanese adult aged 20–30, framed head-to-chest in crisp pixel art on the same deep-teal KILLER background with acid-green and restrained crimson rim lighting. Individual prompts specify the catalogued hairstyle and muted contemporary clothing; all exclude text, weapons, phones, uniforms, badges, props, and role clues.

`scripts/prepare-japanese-character-assets.cjs` center-crops the sources and emits their 256×256 WebP files.
