# Stage Cue Render server

This service hosts independent Stage View rooms for every church. The
room/instance ID is exactly the church `_id` already stored in MongoDB Atlas;
the Render server does not connect to MongoDB and does not create another ID.

Stable viewer URLs use this form:

```text
https://YOUR-SERVICE.onrender.com/stage-view/MONGODB_CHURCH_ID
```

The same church keeps the same URL after the desktop app closes or the user
signs in again. Render holds only the most recent cue for each church in memory,
so a Render restart clears the visible cue but does not change the URL or
instance ID. The next presentation action repopulates it automatically.

## Deploy on Render

1. Commit this source folder without `.git` or `node_modules`.
2. Create a Blueprint from `render.yaml`, or create a Node web service with
   `npm ci` as the build command and `npm start` as the start command.
3. Set `STAGE_CUE_CONTROL_TOKEN` to a strong random secret.
4. Redeploy the service.
5. Enter the service URL and the same token in Stage Cue's **Output Setup**.

The token protects cue updates. Viewer URLs are intentionally read-only and do
not need the token. Treat each church ID as public routing data, not as a
password.

## API

Stage Cue posts automatically when a slide is presented:

```http
POST /api/churches/:churchId/cue
Authorization: Bearer STAGE_CUE_CONTROL_TOKEN
Content-Type: application/json

{"cue": {"version": 2, "mode": "LIVE", "text": "...", "settings": {}}}
```

The desktop sends each church's dedicated Stage View style in `settings`. When
`settings.showNextSlide` is true, `cue.nextText` is rendered along the bottom of
the page. Live View styling and the in-app Preview remain local to the desktop.

The previous `/api/cue` and VideoPsalm `/update-slide` endpoints remain for
compatibility, but both now require a valid `churchId` and the configured token.

## Local verification

```bash
npm ci
npm test
npm start
```
