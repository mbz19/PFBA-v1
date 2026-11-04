// Workouts: each workout is its own sheet tab ("Workout - Push Day") holding
// an ordered, editable list of exercises. Thin wrapper over sheets.js.
import * as sheets from './sheets.js';
import { WORKOUT_PREFIX } from './schema.js';

export const displayName = (tab) => tab.slice(WORKOUT_PREFIX.length);

export const list = () => sheets.workoutTabs().map((tab) => ({ tab, name: displayName(tab), count: sheets.rows(tab).length }));
export const exercises = (tab) => sheets.rows(tab);

export const create = (name) => sheets.createWorkoutTab(name);
export const rename = (tab, name) => sheets.renameWorkoutTab(tab, name);
export const remove = (tab) => sheets.deleteWorkoutTab(tab);

export const addExercise = (tab, ex) => sheets.insert(tab, ex);
export const updateExercise = (tab, id, patch) => sheets.update(tab, id, patch);
export const deleteExercise = (tab, id) => sheets.remove(tab, id);

export function moveExercise(tab, id, delta) {
  const rows = [...sheets.rows(tab)];
  const i = rows.findIndex((r) => r.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= rows.length) return;
  [rows[i], rows[j]] = [rows[j], rows[i]];
  sheets.setRows(tab, rows);
}
