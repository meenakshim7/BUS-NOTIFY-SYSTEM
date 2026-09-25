# Bus Notify System

Admin adds bus stops and assigns each student to a bus AND a stop.
The student's page shows the live distance between THAT bus and THAT
stop — the student's own location is never used.

## 1. Setup

```bash
npm install
npm start
```

Then open:
- **Admin page:**   http://localhost:3000/admin.html
- **Student page:** http://localhost:3000/student.html

## 2. How the pieces fit together

```
 ADMIN PAGE                    SERVER (server.js)              STUDENT PAGE
 ----------                    -------------------              ------------
 Add stop (name, lat, lon) --> saved in data/stops.json
 Assign student -> bus+stop --> saved in data/assignments.json

                                                            <-- "distance between
                                                                 my bus and my stop?"
                                                            <-- gets distance back

 (Manual test tool, OR       --> saved in data/busLocations.json
  later: your fake-bus
  emitter program)  ---------------------------------------> student page polls
                                                                every 5 seconds.
                                                                Server computes
                                                                Haversine distance
                                                                between the BUS's
                                                                live position and
                                                                the STOP's fixed
                                                                position, and shows
                                                                the notification
                                                                once within 2 km.
```

Note: the student's own device location is not used anywhere in this
flow anymore — everything is computed server-side from data the admin
and the bus emitter provide.

## 3. Try it end-to-end right now (before the fake-bus program exists)

1. Open **admin.html** → add a stop, e.g. name it "Stop001" with some lat/lon
   (you can grab a real lat/lon from the "Show My Coordinates" tool for testing).
2. In **"Assign Student to Bus & Stop"**, fill in Student ID `student_1`,
   Bus ID `bus_1`, and pick "Stop001" from the dropdown. Click Assign.
3. Open **student.html** in another tab, enter `student_1`, click "Start Watching".
   - No location permission is asked — this page doesn't need it anymore.
   - It will say "No location received from this bus yet" — expected,
     since nothing has sent a bus location.
4. Go back to **admin.html**, scroll to **"Manual Bus Location (temporary test tool)"**,
   enter `bus_1` and a lat/lon close to Stop001's coordinates (within 2km), then Send.
5. Within 5 seconds, the student page flips to the green
   "🔔 Bus bus_1 is near Stop001!" state, showing the exact distance.

Try sending a bus location far from the stop instead, and you'll see it
stay in the "X km away" state.

## 4. Where your future fake-bus program plugs in

Your fake-bus emitter (the one you'll build next, simulating a moving bus)
just needs to repeatedly send:

```
POST http://localhost:3000/api/bus-location
Content-Type: application/json

{ "busId": "bus_1", "lat": 13.0827, "lon": 80.2707 }
```

Every time it does, the student page's next poll (within 5 seconds) will
pick up the new position automatically — no changes needed on this side.
Once that program exists, you can retire the "Manual Bus Location" test
tool in admin.html, or just leave it there for quick manual testing.

## 5. The log file

Every stop added, assignment made, and bus location update gets appended
to `activity.log` in this folder, with a timestamp — a running history,
never overwritten.

## 6. Known simplifications (worth knowing, not hidden)

- No login/authentication — anyone with the link can act as admin or
  enter any student ID. Fine for a prototype/demo, not for real deployment.
- Notification is shown only ON the student's page while it's open — this
  is not a push notification, so the tab needs to stay open to see it.
- Data is stored in plain JSON files, not a real database — fine at this
  scale, but you'd want to move to your actual DB schema (Module 1/3 from
  your transport project design) once this moves past prototyping.
- A student must be assigned to a stop that already exists in `stops.json`
  before assignment — the server rejects assigning a stopId that doesn't
  exist yet, so always add stops first, then assign.
