# Local interface fonts

The runtime serves [orbitron.ttf](orbitron.ttf) and [rajdhani.ttf](rajdhani.ttf) locally. No Google Fonts stylesheet/CDN is required.

- Orbitron variable, weights 400–900: unchanged font bytes from official Google Fonts commit `8b0a1d0f5983c89bc2b93f1b5fb55f9e252744b5`. Copyright 2018 The Orbitron Project Authors; Reserved Font Name Orbitron. [Upstream font](https://raw.githubusercontent.com/google/fonts/8b0a1d0f5983c89bc2b93f1b5fb55f9e252744b5/ofl/orbitron/Orbitron%5Bwght%5D.ttf), [retained OFL notice](orbitron-OFL.txt).
- Rajdhani Medium, weight 500: unchanged font bytes from official Google Fonts commit `8772f86137e17678cbd3584ca9a3c9486c3e7e50`. Copyright 2014 Indian Type Foundry. [Upstream font](https://raw.githubusercontent.com/google/fonts/8772f86137e17678cbd3584ca9a3c9486c3e7e50/ofl/rajdhani/Rajdhani-Medium.ttf), [retained OFL notice](rajdhani-OFL.txt).

Both fonts retain the SIL Open Font License 1.1; the complete original notices are packaged here. Only the local filenames were shortened. Internal font names, outlines and font bytes are unchanged. Do not declare the static Medium file as a variable weight range.

[manifest.json](manifest.json) records immutable source URLs, font and license SHA-256, family/style/weight and changes. From the repository root, `node scripts/acquire-fonts.mjs` acquires missing files and verifies every byte against the pinned hashes; it rejects altered local or remote content. Existing prepared builds do not need to run this tool or access the network. The font-asset unit test verifies the packaged hashes, TrueType signature and retained license.
