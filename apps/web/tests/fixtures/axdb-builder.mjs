// Shared VisualAX-schema `.axdb` builder core, used by every fixture-generation
// script under tests/fixtures/ that needs a full single-event synthetic export
// (build-multi-event-season.mjs, build-combined-event-season.mjs).
//
// Extracted from build-multi-event-season.mjs (M1.15) so both scripts share one
// source of truth for the schema DDL and row-insertion logic rather than
// drifting copies. Behavior is byte-equivalent to the pre-extraction inline
// version.

import { rmSync } from "node:fs";
import Database from "better-sqlite3";

export const SCHEMA = `
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
`;

/**
 * Build a single-event .axdb fixture.
 * @param {string} outPath   - absolute output file path
 * @param {string} eventName
 * @param {string} eventDate  - "YYYY-MM-DD"
 * @param {number} eventTs    - Unix timestamp for event
 * @param {Array}  classes    - [{id, name, paxed, pax}]
 * @param {Array}  drivers    - [{id, last, first, num, classId, paxId, memberNum}]
 * @param {Array}  runs       - [{driverId, deltaMs, cones, disposition}]
 * @param {Map|null} overrides - Map<driverId, bestcommittedrun_no> for committed-run overrides.
 *                               Drivers not in the map get bestcommittedrun_no pointing to
 *                               run #1 (the only run for most drivers in this fixture).
 * @returns {{events: number, drivers: number, runs: number}}
 */
export function buildEventAxdb(outPath, eventName, eventDate, eventTs, classes, drivers, runs, overrides = null) {
  rmSync(outPath, { force: true });

  const db = new Database(outPath);
  db.pragma("journal_mode = DELETE");
  db.pragma("foreign_keys = OFF");
  db.exec(SCHEMA);

  const insertEvent = db.prepare(`
    INSERT INTO events (event_name, event_date, num_runs, mirrored, unique_numbers, org_name, timing_mode, typical_time, web_active, run_timestamp)
    VALUES (?, ?, ?, 0, 0, ?, 0, ?, 1, ?)
  `);
  const insertClass = db.prepare(`INSERT INTO classes (class_name, paxed_class, pax, run_timestamp) VALUES (?, ?, ?, ?)`);
  const insertDriver = db.prepare(`
    INSERT INTO drivers (id, last_name, first_name, number, class_id, paxmult_id, car_model, car_color, member_num, sponsor, tire, email, cellphone, member, registered, icon_color)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '', '', '', '', 1, 1, 'red')
  `);
  const insertReg = db.prepare(`
    INSERT INTO registrations (driver_id, event_id, bestcommittedrun_id, bestcommittedrun_no, run_timestamp)
    VALUES (?, 1, ?, ?, ?)
  `);
  const insertRun = db.prepare(`
    INSERT INTO runs (event_id, driver_id, start_at, finish_at, start_tick, finish_tick, cones, disposition, status)
    VALUES (1, ?, ?, ?, ?, ?, ?, ?, 3)
  `);
  const lastRowId = db.prepare("SELECT last_insert_rowid() AS id");

  db.transaction(() => {
    insertEvent.run(eventName, eventDate, 6, "RMR Synthetic", 55.0, eventTs);

    for (const c of classes) {
      insertClass.run(c.name, c.paxed ? 1 : 0, c.pax, eventTs);
    }

    for (const d of drivers) {
      insertDriver.run(d.id, d.last, d.first, d.num, d.classId, d.paxId, d.car ?? null, d.color ?? null, d.memberNum ?? null);
    }

    // Insert runs and track (driverId → [{runId, runNo}]) for registration population.
    const runsByDriver = new Map();
    let wallSec = eventTs + 1800;
    let tick = 5_000_000;

    for (const r of runs) {
      const isClean = !r.disposition || r.disposition === "";
      insertRun.run(
        r.driverId,
        wallSec,
        wallSec + (isClean ? Math.ceil(r.deltaMs / 1000) : 1),
        tick,
        isClean ? tick + r.deltaMs : tick + 1,
        r.cones ?? 0,
        r.disposition ?? "",
      );
      const runId = lastRowId.get().id;
      const list = runsByDriver.get(r.driverId) ?? [];
      list.push({ runId, runNo: list.length + 1 });
      runsByDriver.set(r.driverId, list);
      wallSec += 60;
      tick += 90_000;
    }

    // Insert registrations with bestcommittedrun_id and bestcommittedrun_no.
    // For drivers in overrides map, use the specified run number.
    // For all others, point to run #1 (default — all single-run drivers).
    for (const d of drivers) {
      const driverRuns = runsByDriver.get(d.id) ?? [];
      const overrideNo = overrides?.get(d.id) ?? null;
      const commitNo = overrideNo ?? (driverRuns.length > 0 ? 1 : null);
      const commitEntry = driverRuns.find((r) => r.runNo === commitNo);
      const commitId = commitEntry?.runId ?? null;
      insertReg.run(d.id, commitId, commitNo, eventTs);
    }
  })();

  const counts = {
    events: db.prepare("SELECT COUNT(*) AS n FROM events").get().n,
    drivers: db.prepare("SELECT COUNT(*) AS n FROM drivers").get().n,
    runs: db.prepare("SELECT COUNT(*) AS n FROM runs").get().n,
  };
  db.close();
  return counts;
}
