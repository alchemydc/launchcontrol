// Regenerate the synthetic AxWare .axdb fixture used by ingestion tests.
//
// Run from apps/web:
//   node tests/fixtures/build-synthetic-axdb.mjs
//
// Output: tests/fixtures/synthetic.axdb (committed)
//
// The schema mirrors a real AxWare .axdb. The data is entirely fake —
// see feedback_sensitive_axdb_fixtures memory for why we never use real data here.

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { rmSync } from "node:fs";
import Database from "better-sqlite3";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "synthetic.axdb");

rmSync(out, { force: true });

const db = new Database(out);
db.pragma("journal_mode = DELETE");
db.pragma("foreign_keys = OFF");

db.exec(`
  CREATE TABLE 'events' (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    event_name      VARCHAR(40) NOT NULL,
    event_date      DATE        NOT NULL,
    num_runs        INTEGER     NOT NULL,
    mirrored        BOOLEAN     NOT NULL,
    unique_numbers  BOOLEAN     NOT NULL,
    org_name        VARCHAR(40) NOT NULL,
    timing_mode     INTEGER     NOT NULL,
    typical_time    FLOAT       NOT NULL,
    web_active      BOOLEAN     NOT NULL,
    run_timestamp   INTEGER
  );

  CREATE TABLE 'classes' (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    class_name      VARCHAR(20) NOT NULL UNIQUE,
    paxed_class     BOOLEAN DEFAULT 0  NOT NULL,
    pax             FLOAT   DEFAULT "1.0" NOT NULL,
    run_timestamp   INTEGER
  );
  CREATE INDEX 'idx_classes_class_name' ON 'classes' (class_name);

  CREATE TABLE 'drivers' (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    last_name       VARCHAR(30) NOT NULL,
    first_name      VARCHAR(30) NOT NULL,
    number          VARCHAR(6)  NOT NULL,
    class_id        INTEGER     NOT NULL,
    paxmult_id      INTEGER     NOT NULL,
    car_model       VARCHAR(40),
    car_color       VARCHAR(20),
    member_num      VARCHAR(30),
    sponsor         VARCHAR(40),
    tire            VARCHAR(40),
    email           VARCHAR(60),
    cellphone       VARCHAR(20),
    member          BOOLEAN,
    registered      BOOLEAN,
    icon_color      VARCHAR(20),
    FOREIGN KEY (class_id)   REFERENCES classes ON UPDATE RESTRICT ON DELETE RESTRICT,
    FOREIGN KEY (paxmult_id) REFERENCES classes ON UPDATE RESTRICT ON DELETE RESTRICT
  );
  CREATE INDEX 'idx_drivers_number'     ON 'drivers' (number);
  CREATE INDEX 'idx_drivers_class_id'   ON 'drivers' (class_id);
  CREATE INDEX 'idx_drivers_last_name'  ON 'drivers' (last_name);
  CREATE INDEX 'idx_drivers_first_name' ON 'drivers' (first_name);

  CREATE TABLE 'registrations' (
    driver_id            INTEGER NOT NULL,
    event_id             INTEGER NOT NULL,
    bestcommittedrun_id  INTEGER,
    bestcommittedrun_no  INTEGER,
    bestpendingrun_id    INTEGER,
    run_timestamp        INTEGER,
    FOREIGN KEY (driver_id) REFERENCES drivers ON UPDATE RESTRICT ON DELETE RESTRICT,
    FOREIGN KEY (event_id)  REFERENCES events  ON UPDATE RESTRICT ON DELETE RESTRICT
  );
  CREATE INDEX 'idx_registrations_driver_id' ON 'registrations' (driver_id);
  CREATE INDEX 'idx_registrations_event_id'  ON 'registrations' (event_id);

  CREATE TABLE 'runs' (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id     INTEGER NOT NULL,
    driver_id    INTEGER NOT NULL,
    start_at     INTEGER,
    finish_at    INTEGER,
    start_tick   INTEGER,
    finish_tick  INTEGER,
    cones        INTEGER,
    disposition  VARCHAR(10),
    status       INTEGER NOT NULL,
    FOREIGN KEY (event_id)  REFERENCES events  ON UPDATE RESTRICT ON DELETE RESTRICT,
    FOREIGN KEY (driver_id) REFERENCES drivers ON UPDATE RESTRICT ON DELETE RESTRICT
  );
  CREATE INDEX 'idx_runs_driver_id' ON 'runs' (driver_id);
  CREATE INDEX 'idx_runs_event_id'  ON 'runs' (event_id);
`);

const insertEvent = db.prepare(`
  INSERT INTO events (
    event_name, event_date, num_runs, mirrored, unique_numbers,
    org_name, timing_mode, typical_time, web_active, run_timestamp
  ) VALUES (?, ?, ?, 0, 0, ?, 0, ?, 1, ?)
`);

const insertClass = db.prepare(`
  INSERT INTO classes (class_name, paxed_class, pax, run_timestamp)
  VALUES (?, ?, ?, ?)
`);

const insertDriver = db.prepare(`
  INSERT INTO drivers (
    last_name, first_name, number, class_id, paxmult_id,
    car_model, car_color, member_num, sponsor, tire,
    email, cellphone, member, registered, icon_color
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?)
`);

const insertReg = db.prepare(`
  INSERT INTO registrations (driver_id, event_id, bestcommittedrun_id, bestcommittedrun_no, run_timestamp)
  VALUES (?, ?, ?, ?, ?)
`);

const insertRun = db.prepare(`
  INSERT INTO runs (
    event_id, driver_id, start_at, finish_at,
    start_tick, finish_tick, cones, disposition, status
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const eventTs = 1767258000; // 2026-01-01 09:00:00 UTC

db.transaction(() => {
  insertEvent.run(
    "Synthetic Fixture Event",
    "2026-01-01",
    8,
    "Synthetic Region",
    55.0,
    eventTs,
  );

  // (id, name, paxed, pax)
  const classes = [
    [1, "C1", 0, 1.0],
    [2, "CS", 1, 0.92],
    [3, "TO", 0, 0.85],
  ];
  for (const [, name, paxed, pax] of classes) {
    insertClass.run(name, paxed, pax, eventTs);
  }

  // (lastName, firstName, number, classId, paxClassId, car, color, memberNum, iconColor)
  const drivers = [
    ["Ada",      "Alex",   "001", 1, 1, "1999 Test Car",         "red",    "SYN-001", "red"],
    ["Brook",    "Bea",    "002", 1, 1, "2001 Practice Roadster","blue",   "SYN-002", "blue"],
    ["Chen",     "Cam",    "003", 2, 2, "2010 Sample Coupe",     "green",  "SYN-003", "green"],
    ["Diaz",     "Dee",    "004", 2, 2, "1985 Demo 911",         "yellow", "SYN-004", "yellow"],
    ["Eckhart",  "Evan",   "005", 3, 3, "2018 Filler GT",        "black",  "SYN-005", "black"],
    ["Ada",      "Andrew", "006", 1, 1, "2002 Family Coupe",     "white",  "SYN-001", "white"],
  ];
  for (const [last, first, num, classId, paxId, car, color, memberNum, icon] of drivers) {
    insertDriver.run(
      last, first, num, classId, paxId,
      car, color, memberNum, "", "", "", "", icon,
    );
  }

  // Runs are inserted in this exact order; their auto-increment IDs are:
  //   Driver 1 (Alex Ada):    R1=id1, R2=id2 (committed), R3=id3 (fastest clean)
  //   Driver 2 (Bea Brook):   R1=id4, R2=id5, R3=id6 (fastest clean)
  //   Driver 3 (Cam Chen):    R1=id7, R2=id8 (DNF), R3=id9 (fastest clean), R4=id18 (OFF)
  //   Driver 4 (Dee Diaz):    R1=id10, R2=id11 (RRN), R3=id12 (fastest clean), R4=id19 (DSQ)
  //   Driver 5 (Evan Eckhart):R1=id13, R2=id14 (fastest clean), R3=id20 (status=4, cancelled)
  //   Driver 6 (Andrew Ada):  R1=id15, R2=id16, R3=id17 (fastest clean)
  //
  // Driver 1 override: bestcommittedrun_no=2 (R2, corrected 51902+2000=53902ms),
  //   but fastest clean is R3 (51488ms). This exercises the bestcommittedrun override path.
  // disposition: '' (clean) | 'DNF' | 'RRN' | 'OFF' | 'DSQ'
  // status: 3=committed (ingested), 4=cancelled (must NOT be ingested)
  const runs = [
    // [driverId, deltaMs, cones, disposition, status]
    [1, 52341, 0, "",    3],
    [1, 51902, 1, "",    3],  // ← committed best for driver 1 (R2, corrected 53902ms)
    [1, 51488, 0, "",    3],  // ← fastest clean for driver 1 (should be overridden by committed)
    [2, 55120, 0, "",    3],
    [2, 54732, 0, "",    3],
    [2, 54201, 0, "",    3],
    [3, 58440, 0, "",    3],
    [3, 70000, 0, "DNF", 3],
    [3, 57990, 0, "",    3],
    [4, 60511, 0, "",    3],
    [4, 59880, 0, "RRN", 3],
    [4, 59210, 0, "",    3],
    [5, 63010, 0, "",    3],
    [5, 62540, 0, "",    3],
    [6, 53000, 0, "",    3],
    [6, 52500, 0, "",    3],
    [6, 52000, 0, "",    3],
    [3, 59000, 0, "OFF", 3],  // OFF run for driver 3 — persisted, excluded from best-time
    [4, 61000, 0, "DSQ", 3],  // DSQ run for driver 4 — persisted, excluded from best-time
    [5, 64000, 0, "",    4],  // cancelled run (status=4) for driver 5 — must NOT be ingested
  ];

  // Each run takes 60s of wall clock. Tick origin is arbitrary.
  let wallSec = eventTs + 1800; // start runs 30 min into the event
  let tick = 5_000_000;

  for (const [driverId, deltaMs, cones, disposition, status] of runs) {
    insertRun.run(
      1,                        // event_id
      driverId,
      wallSec,                  // start_at (seconds)
      wallSec + Math.ceil(deltaMs / 1000), // finish_at (seconds)
      tick,                     // start_tick (ms)
      tick + deltaMs,           // finish_tick (ms)
      cones,
      disposition,
      status,
    );
    wallSec += 60;
    tick    += 90_000; // 90s between car starts including return
  }

  // Registrations with bestcommittedrun_id and bestcommittedrun_no.
  // Run IDs match insertion order above (auto-increment from 1).
  // Driver 1 override: committed=R2 (id=2, no=2), fastest clean=R3 (id=3, no=3).
  const registrations = [
    // [driverId, bestcommittedrun_id, bestcommittedrun_no]
    [1, 2,  2],  // override: R2 committed (53902ms corrected), R3 fastest clean (51488ms)
    [2, 6,  3],  // R3 fastest clean (54201ms)
    [3, 9,  3],  // R3 fastest clean (57990ms)
    [4, 12, 3],  // R3 fastest clean (59210ms)
    [5, 14, 2],  // R2 fastest clean (62540ms); R3(status=4) not ingested
    [6, 17, 3],  // R3 fastest clean (52000ms)
  ];
  for (const [driverId, commitId, commitNo] of registrations) {
    insertReg.run(driverId, 1, commitId, commitNo, eventTs);
  }
})();

const counts = {
  events:        db.prepare("SELECT COUNT(*) AS n FROM events").get().n,
  classes:       db.prepare("SELECT COUNT(*) AS n FROM classes").get().n,
  drivers:       db.prepare("SELECT COUNT(*) AS n FROM drivers").get().n,
  registrations: db.prepare("SELECT COUNT(*) AS n FROM registrations").get().n,
  runs:          db.prepare("SELECT COUNT(*) AS n FROM runs").get().n,
  runs_status3:  db.prepare("SELECT COUNT(*) AS n FROM runs WHERE status=3").get().n,
  runs_status4:  db.prepare("SELECT COUNT(*) AS n FROM runs WHERE status=4").get().n,
  dnf:           db.prepare("SELECT COUNT(*) AS n FROM runs WHERE disposition='DNF'").get().n,
  rrn:           db.prepare("SELECT COUNT(*) AS n FROM runs WHERE disposition='RRN'").get().n,
  off:           db.prepare("SELECT COUNT(*) AS n FROM runs WHERE disposition='OFF'").get().n,
  dsq:           db.prepare("SELECT COUNT(*) AS n FROM runs WHERE disposition='DSQ'").get().n,
};

db.close();

console.log("Wrote", out);
console.log(counts);
// Expected: events=1, classes=3, drivers=6, registrations=6, runs=20,
//           runs_status3=19, runs_status4=1, dnf=1, rrn=1, off=1, dsq=1
