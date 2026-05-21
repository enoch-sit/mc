# Deploying the MC Cue App

## Vercel

1. Import this repository into Vercel.
2. Set the Root Directory to `webapp` if you want the cue app to be the deployed site.
3. Before deployment, edit `webapp/config.js` and change the passcode.
4. Run `npm run build:cues` locally whenever the source extracts change so `webapp/data/mc_cue_index.json` stays fresh.

## Important

- The passcode gate in `webapp/config.js` is only a convenience layer.
- Static hosting cannot provide real password protection.
- If you later need real access control, move the app behind server-side auth.