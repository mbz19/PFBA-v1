// Google Picker: browse the primary account's Drive and choose an existing
// spreadsheet instead of pasting its link. Picking a file also grants the
// drive.file scope access to it. The Picker opens as an in-page dialog (not a
// popup), so it doesn't need to start inside a tap.

import { accessToken } from './auth.js';

const API_KEY = import.meta.env.VITE_GOOGLE_API_KEY;
// The Picker's app ID is the Cloud project number, which is the client ID's prefix.
const APP_ID = (import.meta.env.VITE_GOOGLE_CLIENT_ID || '').split('-')[0];

export const isPickerConfigured = () => Boolean(API_KEY && APP_ID);

const pickerReady = () => Boolean(window.google?.picker?.PickerBuilder);
let loadPromise = null;
export function preloadPicker() {
  if (pickerReady()) return Promise.resolve();
  if (!loadPromise) {
    loadPromise = new Promise((resolve, reject) => {
      const fail = () => { loadPromise = null; reject(new Error('Could not load the Google Drive picker.')); };
      const loadPicker = () => window.gapi.load('picker', { callback: resolve, onerror: fail });
      if (window.gapi?.load) return loadPicker();
      const s = document.createElement('script');
      s.src = 'https://apis.google.com/js/api.js';
      s.async = true;
      s.onload = loadPicker;
      s.onerror = fail;
      document.head.appendChild(s);
    });
  }
  return loadPromise;
}

// Resolves to { id, name } of the chosen spreadsheet, or null if cancelled.
export async function pickSpreadsheet(email) {
  const [token] = await Promise.all([accessToken(email), preloadPicker()]);
  const { picker } = window.google;
  return new Promise((resolve) => {
    const view = new picker.DocsView(picker.ViewId.SPREADSHEETS)
      .setMode(picker.DocsViewMode.LIST);
    new picker.PickerBuilder()
      .addView(view)
      .setTitle('Choose your spreadsheet')
      .setOAuthToken(token)
      .setDeveloperKey(API_KEY)
      .setAppId(APP_ID)
      .setCallback((data) => {
        if (data.action === picker.Action.PICKED) {
          const doc = data.docs[0];
          resolve({ id: doc.id, name: doc.name });
        } else if (data.action === picker.Action.CANCEL) {
          resolve(null);
        }
      })
      .build()
      .setVisible(true);
  });
}
