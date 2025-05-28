
import React, { useState, useEffect, useCallback } from 'react';
import type { CustomerMeasurement } from './types';
import { ViewMode, initialMeasurementState, SHEET_FIELD_ORDER } from './types';
import { FIELD_LABELS_TH, USER_SPREADSHEET_FILENAME } from './constants';
import MeasurementList from './components/MeasurementList';
import MeasurementForm from './components/MeasurementForm';

// Client ID for Google Sign-In, Sheets API, and Drive API.
const GOOGLE_CLIENT_ID_FOR_SHEETS = '436169620275-06sdal64e81ms1ohb5l3q4fbvni7j12s.apps.googleusercontent.com';
// The name of the sheet (tab) within the user's spreadsheet
const SHEET_NAME = 'CustomerData';
// Scopes for Google Sheets API and Google Drive API (to manage files created by the app)
const SCOPES = 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file';

const LOCAL_STORAGE_KEY = 'tailorMeasurementsApp_localStorageFallback';

// Helper to convert sheet row array to CustomerMeasurement object
const rowToMeasurement = (row: any[], rowIndex: number): CustomerMeasurement => {
  const measurement: Partial<CustomerMeasurement> = {};
  SHEET_FIELD_ORDER.forEach((key, index) => {
    if (row[index] !== undefined && key !== 'rowIndex') {
      (measurement as any)[key] = row[index];
    }
  });
  const fullMeasurement = { ...initialMeasurementState, ...measurement, id: measurement.id || '' };
  fullMeasurement.rowIndex = rowIndex; // Sheet row index (1-based)
  return fullMeasurement as CustomerMeasurement;
};

// Helper to convert CustomerMeasurement object to sheet row array
const measurementToRow = (measurement: CustomerMeasurement): any[] => {
  return SHEET_FIELD_ORDER.map(key => (measurement as any)[key] ?? '');
};

declare global {
  interface Window {
    gapi: any;
    google: any;
  }
}

const App: React.FC = () => {
  const [measurements, setMeasurements] = useState<CustomerMeasurement[]>([]);
  const [currentView, setCurrentView] = useState<ViewMode>(ViewMode.List);
  const [editingMeasurement, setEditingMeasurement] = useState<CustomerMeasurement | null>(null);

  const [gapiInited, setGapiInited] = useState(false);
  const [gisInited, setGisInited] = useState(false);
  const [tokenClient, setTokenClient] = useState<any>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [isSignedIn, setIsSignedIn] = useState(false);
  const [userSpreadsheetId, setUserSpreadsheetId] = useState<string | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [statusMessage, setStatusMessage] = useState<string | null>(FIELD_LABELS_TH.LOADING_APP_DATA);
  const [actionRequiresAuth, setActionRequiresAuth] = useState<(() => void) | null>(null);

  const loadMeasurementsFromLocalStorage = useCallback(() => {
    console.log('[App.tsx] loadMeasurementsFromLocalStorage: Loading data from local storage.');
    setIsLoading(true);
    try {
      const storedMeasurements = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (storedMeasurements) {
        const parsed = JSON.parse(storedMeasurements) as CustomerMeasurement[];
        setMeasurements(parsed.map(m => ({ ...initialMeasurementState, ...m })));
      } else {
        setMeasurements([]);
      }
      setStatusMessage(FIELD_LABELS_TH.USING_LOCAL_STORAGE)
    } catch (error) {
      console.error("[App.tsx] loadMeasurementsFromLocalStorage: Failed to load measurements from localStorage:", error);
      setMeasurements([]);
       setStatusMessage(FIELD_LABELS_TH.ERROR_LOADING_LOCAL_DATA);
    }
    setIsLoading(false);
  }, []);


  const findOrCreateUserSpreadsheet = useCallback(async (token: string) => {
    console.log('[App.tsx] findOrCreateUserSpreadsheet: Attempting to find or create spreadsheet.');
    if (!token || !gapiInited) {
        console.warn('[App.tsx] findOrCreateUserSpreadsheet: Called with no token or GAPI not initialized.');
        setStatusMessage(FIELD_LABELS_TH.ERROR_GAPI_NOT_READY);
        setIsLoading(false);
        loadMeasurementsFromLocalStorage(); // Fallback
        return;
    }
    setIsLoading(true);
    setStatusMessage(FIELD_LABELS_TH.AUTHENTICATED_SEARCHING_SHEET);
    try {
      console.log('[App.tsx] findOrCreateUserSpreadsheet: Listing files in Drive...');
      const driveResponse = await window.gapi.client.drive.files.list({
        q: `name='${USER_SPREADSHEET_FILENAME}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`,
        fields: 'files(id, name)',
        spaces: 'drive',
      });
      console.log('[App.tsx] findOrCreateUserSpreadsheet: Drive files.list response:', driveResponse);

      if (driveResponse.result.files && driveResponse.result.files.length > 0) {
        const foundFileId = driveResponse.result.files[0].id;
        console.log(`[App.tsx] findOrCreateUserSpreadsheet: Found existing spreadsheet with ID: ${foundFileId}`);
        setUserSpreadsheetId(foundFileId);
        setStatusMessage(FIELD_LABELS_TH.SPREADSHEET_FOUND_LOADING_DATA);
        await loadMeasurementsFromSheet(token, foundFileId);
      } else {
        console.log('[App.tsx] findOrCreateUserSpreadsheet: Spreadsheet not found, creating new one...');
        setStatusMessage(FIELD_LABELS_TH.SPREADSHEET_NOT_FOUND_CREATING);
        const createResponse = await window.gapi.client.drive.files.create({
          resource: {
            name: USER_SPREADSHEET_FILENAME,
            mimeType: 'application/vnd.google-apps.spreadsheet',
          },
          fields: 'id',
        });
        console.log('[App.tsx] findOrCreateUserSpreadsheet: Drive files.create response:', createResponse);
        const newFileId = createResponse.result.id;
        setUserSpreadsheetId(newFileId);
        setStatusMessage(FIELD_LABELS_TH.SPREADSHEET_CREATED_SETUP_HEADERS);
        await setupSheetHeaders(token, newFileId); // Setup headers for the new sheet
        await loadMeasurementsFromSheet(token, newFileId); // Then load (which should be empty initially)
      }
    } catch (error: any) {
      console.error('[App.tsx] findOrCreateUserSpreadsheet: Error finding or creating spreadsheet:', JSON.stringify(error, null, 2));
      setStatusMessage(`${FIELD_LABELS_TH.ERROR_DRIVE_OPERATION}: ${error.result?.error?.message || error.message}`);
      await updateUiBasedOnAuthState(null); 
    }
    setIsLoading(false);
  }, [gapiInited, loadMeasurementsFromLocalStorage]); // Removed internal calls from deps, added loadMeasurementsFromLocalStorage for fallback.


  const updateUiBasedOnAuthState = useCallback(async (newAccessToken: string | null) => {
    console.log(`[App.tsx] updateUiBasedOnAuthState: Called with newAccessToken: ${newAccessToken ? 'Exists' : 'Null'}, gapiInited: ${gapiInited}, current accessToken state: ${accessToken ? 'Exists' : 'Null'}`);

    if (newAccessToken !== accessToken) {
        console.log('[App.tsx] updateUiBasedOnAuthState: New token received, updating accessToken state.');
        setAccessToken(newAccessToken);
    }

    // Use the newAccessToken if provided, otherwise use the existing accessToken from state.
    // This allows the function to react to fresh tokens or refresh based on existing state if called with null.
    const tokenToUse = newAccessToken; // Prioritize the fresh token if it's passed. If null, means sign-out or refresh.

    console.log(`[App.tsx] updateUiBasedOnAuthState: Effective tokenToUse: ${tokenToUse ? 'Exists' : 'Null'}. Proceeding with gapiInited: ${gapiInited}`);

    if (tokenToUse && gapiInited) {
      console.log('[App.tsx] updateUiBasedOnAuthState: Token exists and GAPI initialized. Setting GAPI token and finding/creating sheet.');
      const currentGapiToken = window.gapi?.client?.getToken?.();
      if (!currentGapiToken || currentGapiToken.access_token !== tokenToUse) {
        if (window.gapi?.client) {
            console.log('[App.tsx] updateUiBasedOnAuthState: Setting token for gapi.client.');
            window.gapi.client.setToken({ access_token: tokenToUse });
        } else {
            console.warn("[App.tsx] updateUiBasedOnAuthState: gapiInited is true, but gapi.client is not available to setToken.");
            setIsSignedIn(false);
            setStatusMessage(FIELD_LABELS_TH.ERROR_GAPI_CLIENT_UNEXPECTED);
            loadMeasurementsFromLocalStorage();
            setIsLoading(false); // Ensure loading stops
            return;
        }
      }
      setIsSignedIn(true);
      await findOrCreateUserSpreadsheet(tokenToUse);
    } else if (tokenToUse && !gapiInited) {
      console.log('[App.tsx] updateUiBasedOnAuthState: Token exists but GAPI NOT YET initialized. Setting signedIn, status "Authenticated with Google. Initializing API services..."');
      setIsSignedIn(true); // Tentatively true, Google auth happened
      setStatusMessage(FIELD_LABELS_TH.AUTHENTICATED_INITIALIZING_APIS); // More specific message
      setIsLoading(true); // Still loading GAPI
    } else { // No token (tokenToUse is null)
      console.log('[App.tsx] updateUiBasedOnAuthState: No token. Setting signedOut, using local storage.');
      setIsSignedIn(false);
      setUserSpreadsheetId(null);
      setAccessToken(null); // Explicitly clear accessToken state on sign-out
      if (window.gapi?.client) {
         console.log('[App.tsx] updateUiBasedOnAuthState: Clearing token for gapi.client.');
         window.gapi.client.setToken(null);
      }
      setStatusMessage(FIELD_LABELS_TH.USING_LOCAL_STORAGE);
      loadMeasurementsFromLocalStorage();
    }
  }, [gapiInited, accessToken, loadMeasurementsFromLocalStorage, findOrCreateUserSpreadsheet]);


  useEffect(() => {
    console.log('[App.tsx] useEffect[]: Initializing Google API scripts.');
    setStatusMessage(FIELD_LABELS_TH.LOADING_APP_DATA + " (Google API)...");
    const gapiScript = document.createElement('script');
    gapiScript.src = "https://apis.google.com/js/api.js";
    gapiScript.async = true;
    gapiScript.defer = true;
    gapiScript.onload = () => {
        console.log('[App.tsx] GAPI script loaded. Calling gapi.load("client").');
        window.gapi.load('client', initializeGapiClient);
    };
    document.body.appendChild(gapiScript);

    const gisScript = document.createElement('script');
    gisScript.src = "https://accounts.google.com/gsi/client";
    gisScript.async = true;
    gisScript.defer = true;
    gisScript.onload = () => {
      console.log('[App.tsx] GIS script loaded. Initializing token client.');
      setGisInited(true);
      const client = window.google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID_FOR_SHEETS,
        scope: SCOPES,
        callback: async (tokenResponse: any) => {
          console.log('[App.tsx] GIS Token Callback: Received tokenResponse:', tokenResponse);
          if (tokenResponse && tokenResponse.access_token) {
            console.log('[App.tsx] GIS Token Callback: Access token received. Calling updateUiBasedOnAuthState.');
            await updateUiBasedOnAuthState(tokenResponse.access_token);
             if (actionRequiresAuth) {
              console.log('[App.tsx] GIS Token Callback: Executing pending actionRequiresAuth.');
              actionRequiresAuth();
              setActionRequiresAuth(null);
            }
          } else {
            console.error('[App.tsx] GIS Token Callback: Token response error or access_token missing.', tokenResponse);
            setStatusMessage(FIELD_LABELS_TH.ERROR_AUTHENTICATING);
            await updateUiBasedOnAuthState(null);
          }
        },
      });
      setTokenClient(client);
      // This logic might be redundant if updateUiBasedOnAuthState handles all cases
      if(gapiInited && !accessToken) { 
        console.log('[App.tsx] GIS onload: GAPI inited but no access token. Calling updateUiBasedOnAuthState(null).');
        updateUiBasedOnAuthState(null);
      } else if (!gapiInited && !accessToken) { 
        console.log('[App.tsx] GIS onload: Neither GAPI inited nor access token. Setting loading status.');
        setStatusMessage(FIELD_LABELS_TH.LOADING_APP_DATA + " (Google API)...");
        setIsLoading(true);
      }
    };
    document.body.appendChild(gisScript);

    return () => {
      console.log('[App.tsx] useEffect[] cleanup: Removing API scripts.');
      if (gapiScript.parentNode) gapiScript.parentNode.removeChild(gapiScript);
      if (gisScript.parentNode) gisScript.parentNode.removeChild(gisScript);
    };
  }, []); // Keep empty for one-time script loading. initializeGapiClient & updateUiBasedOnAuthState are stable or managed internally.

  const initializeGapiClient = useCallback(async () => {
    console.log('[App.tsx] initializeGapiClient: Starting GAPI client initialization.');
    setStatusMessage(FIELD_LABELS_TH.GAPI_INITIALIZING);
    console.time("gapiClientInit");
    try {
      await window.gapi.client.init({
        discoveryDocs: [
          'https://sheets.googleapis.com/$discovery/rest?version=v4',
          'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest',
        ],
      });
      console.timeEnd("gapiClientInit");
      console.log('[App.tsx] initializeGapiClient: GAPI client initialized successfully.');
      setGapiInited(true);
      setStatusMessage(FIELD_LABELS_TH.GAPI_INIT_SUCCESS);

      const gapiTokenInfo = window.gapi.client.getToken?.();
      // Use the accessToken from React state, as it should be the latest from GIS if sign-in happened.
      // If GAPI has a token and React state doesn't, that's an unusual state but could happen if GAPI persisted it.
      const tokenForUpdate = accessToken || gapiTokenInfo?.access_token; 
      console.log(`[App.tsx] initializeGapiClient: Token for updateUiBasedOnAuthState after GAPI init: ${tokenForUpdate ? 'Exists' : 'Null'}`);
      await updateUiBasedOnAuthState(tokenForUpdate);

    } catch (error: any) {
      console.timeEnd("gapiClientInit"); // Call on error too, if it started
      console.error('[App.tsx] initializeGapiClient: Error initializing Google API client:', JSON.stringify(error, null, 2));
      let detailedErrorMessage = 'Unknown error during GAPI init.';
      if (error.result && error.result.error) {
        detailedErrorMessage = `Code: ${error.result.error.code}, Message: ${error.result.error.message}, Details: ${JSON.stringify(error.result.error.errors)}`;
      } else if (error.details) {
        detailedErrorMessage = error.details;
      } else if (error.message) {
        detailedErrorMessage = error.message;
      }
      setStatusMessage(`${FIELD_LABELS_TH.ERROR_INITIALIZING_GAPI}: ${detailedErrorMessage}`);
      setGapiInited(false);
      setIsLoading(false);
      await updateUiBasedOnAuthState(null);
    }
  }, [accessToken, updateUiBasedOnAuthState]);


  const handleAuthClick = (callback?: () => void) => {
    if (!tokenClient) {
        console.warn('[App.tsx] handleAuthClick: Token client not ready.');
        setStatusMessage(FIELD_LABELS_TH.ERROR_GIS_NOT_READY);
        return;
    }
    if (callback) {
        console.log('[App.tsx] handleAuthClick: Setting actionRequiresAuth.');
        setActionRequiresAuth(() => callback);
    }
    const promptValue = accessToken ? 'consent' : ''; // If already signed in, prompt for consent to ensure fresh scopes if needed.
    console.log(`[App.tsx] handleAuthClick: Requesting access token with prompt: '${promptValue}'`);
    tokenClient.requestAccessToken({ prompt: promptValue });
  };

  const handleSignoutClick = () => {
    console.log('[App.tsx] handleSignoutClick: Initiating sign-out.');
    const currentTokenToRevoke = accessToken; // Use the token from state
    if (currentTokenToRevoke && window.google?.accounts?.oauth2?.revoke) {
      console.log('[App.tsx] handleSignoutClick: Revoking token.');
      window.google.accounts.oauth2.revoke(currentTokenToRevoke, async () => {
        console.log('[App.tsx] handleSignoutClick: Token revoked. Calling updateUiBasedOnAuthState(null).');
        await updateUiBasedOnAuthState(null);
      });
    } else {
       console.warn('[App.tsx] handleSignoutClick: No token to revoke or GIS revoke function not available. Forcing UI to signed-out state.');
       updateUiBasedOnAuthState(null);
    }
  };

  const saveMeasurementsToLocalStorage = (currentMeasurements: CustomerMeasurement[]) => {
    try {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(currentMeasurements));
      console.log('[App.tsx] saveMeasurementsToLocalStorage: Data saved to local storage.');
    } catch (error) {
      console.error("[App.tsx] saveMeasurementsToLocalStorage: Failed to save measurements to localStorage:", error);
       setStatusMessage(FIELD_LABELS_TH.ERROR_SAVING_LOCAL_DATA);
    }
  };

  const setupSheetHeaders = useCallback(async (token: string | null, spreadsheetIdToUse: string | null) => {
    if (!token || !gapiInited || !spreadsheetIdToUse) {
        console.warn(`[App.tsx] setupSheetHeaders: Aborted due to missing token, GAPI init status (${gapiInited}), or spreadsheetId.`);
        return;
    }
    console.log(`[App.tsx] setupSheetHeaders: Attempting to set up sheet headers for sheet ID: ${spreadsheetIdToUse}`);
    setStatusMessage(FIELD_LABELS_TH.SETTING_UP_SHEET_HEADERS);
    setIsLoading(true);
    try {
        console.log(`[App.tsx] setupSheetHeaders: Getting spreadsheet details for sheets...`);
        const spreadsheet = await window.gapi.client.sheets.spreadsheets.get({
            spreadsheetId: spreadsheetIdToUse,
            fields: 'sheets.properties.title',
        });
        console.log(`[App.tsx] setupSheetHeaders: Spreadsheet.get response:`, spreadsheet);
        const sheetExists = spreadsheet.result.sheets?.some(s => s.properties?.title === SHEET_NAME);

        if (!sheetExists) {
            console.log(`[App.tsx] setupSheetHeaders: Sheet tab "${SHEET_NAME}" does not exist. Creating...`);
            await window.gapi.client.sheets.spreadsheets.batchUpdate({
                spreadsheetId: spreadsheetIdToUse,
                resource: {
                    requests: [{ addSheet: { properties: { title: SHEET_NAME } } }],
                },
            });
            console.log(`[App.tsx] setupSheetHeaders: Sheet tab "${SHEET_NAME}" created.`);
        } else {
            console.log(`[App.tsx] setupSheetHeaders: Sheet tab "${SHEET_NAME}" already exists.`);
        }
        
        console.log(`[App.tsx] setupSheetHeaders: Updating header row for "${SHEET_NAME}"...`);
        await window.gapi.client.sheets.spreadsheets.values.update({
            spreadsheetId: spreadsheetIdToUse,
            range: `${SHEET_NAME}!A1`,
            valueInputOption: 'USER_ENTERED',
            resource: {
                values: [SHEET_FIELD_ORDER],
            },
        });
        console.log("[App.tsx] setupSheetHeaders: Sheet headers set up successfully in " + SHEET_NAME);
        setStatusMessage(FIELD_LABELS_TH.HEADERS_CONFIGURED_SUCCESS);
    } catch (error: any) {
        console.error('[App.tsx] setupSheetHeaders: Error setting up sheet headers:', JSON.stringify(error, null, 2));
        setStatusMessage(`${FIELD_LABELS_TH.ERROR_SETTING_UP_HEADERS}: ${error.result?.error?.message || 'Unknown error'}`);
    }
    setIsLoading(false);
  }, [gapiInited]);


  const loadMeasurementsFromSheet = useCallback(async (token: string | null, spreadsheetIdToUse: string | null) => {
    if (!token || !gapiInited || !spreadsheetIdToUse) {
      console.warn(`[App.tsx] loadMeasurementsFromSheet: Aborted due to missing token, GAPI init status (${gapiInited}), or spreadsheetId.`);
      setIsLoading(false);
      // If called inappropriately (e.g. no token and no gapi), ensure it falls back.
      // updateUiBasedOnAuthState should handle the main fallback if token is null.
      if (!token && !isSignedIn) { // If there's no token and user is not signed in, fallback to local
         loadMeasurementsFromLocalStorage();
      }
      return;
    }
    console.log(`[App.tsx] loadMeasurementsFromSheet: Loading data from sheet ID: ${spreadsheetIdToUse}`);
    setIsLoading(true);
    setStatusMessage(FIELD_LABELS_TH.SYNCING_DATA);
    try {
      const response = await window.gapi.client.sheets.spreadsheets.values.get({
        spreadsheetId: spreadsheetIdToUse,
        range: `${SHEET_NAME}!A:AZ`, // Read all columns
      });
      console.log('[App.tsx] loadMeasurementsFromSheet: Sheets values.get response:', response);
      const values = response.result.values;
      if (values && values.length > 0) { // Check if there's at least a header row
        const headerRow = values[0];
        if(JSON.stringify(headerRow) !== JSON.stringify(SHEET_FIELD_ORDER)) {
            console.warn("[App.tsx] loadMeasurementsFromSheet: Sheet header mismatch. Expected:", SHEET_FIELD_ORDER, "Got:", headerRow, "Attempting to fix headers.");
            setStatusMessage(FIELD_LABELS_TH.ERROR_SHEET_HEADER_MISMATCH_ATTEMPT_FIX);
            await setupSheetHeaders(token, spreadsheetIdToUse);
            // It's crucial to reload after fixing headers.
            console.log("[App.tsx] loadMeasurementsFromSheet: Retrying loadMeasurementsFromSheet after header fix attempt.");
            await loadMeasurementsFromSheet(token, spreadsheetIdToUse); // Recursive call to reload
            return; // Important to exit here to avoid processing stale data
        }
        // If headers are okay, process data (if any beyond headers)
        const loadedMeasurements = values.slice(1)
          .map((row, index) => rowToMeasurement(row, index + 2)) // index + 2 because sheets are 1-indexed and we sliced header
          .filter(m => m.id); // Ensure items have an ID
        setMeasurements(loadedMeasurements);
        setStatusMessage(loadedMeasurements.length > 0 ? FIELD_LABELS_TH.SYNCED_WITH_GOOGLE_SHEETS : FIELD_LABELS_TH.NO_RECORDS + ` (${FIELD_LABELS_TH.GOOGLE_SHEETS_STORAGE})`);
      } else { // No data at all (not even a header row, or an empty sheet was returned)
        console.log(`[App.tsx] loadMeasurementsFromSheet: No values found in sheet "${SHEET_NAME}". Assuming empty sheet or needs headers.`);
        setMeasurements([]);
        setStatusMessage(FIELD_LABELS_TH.NO_RECORDS + ` (${FIELD_LABELS_TH.GOOGLE_SHEETS_STORAGE}) - ${FIELD_LABELS_TH.ERROR_EMPTY_RESPONSE}`);
        await setupSheetHeaders(token, spreadsheetIdToUse); // Attempt to set up headers if sheet is completely empty
      }
    } catch (error: any) {
      console.error('[App.tsx] loadMeasurementsFromSheet: Error loading measurements from Google Sheets:', JSON.stringify(error, null, 2));
      const errorMessage = error.result?.error?.message || error.message || 'Unknown error';
      if (error.result?.error?.status === 'NOT_FOUND' || errorMessage.toLowerCase().includes('requested entity was not found') || (error.result?.error?.code === 400 && errorMessage.toLowerCase().includes('unable to parse range'))) {
        // 400 error with "Unable to parse range" often means the SHEET_NAME doesn't exist.
        console.warn(`[App.tsx] loadMeasurementsFromSheet: Sheet tab "${SHEET_NAME}" likely not found or error parsing range. Attempting to create/fix headers.`);
        setStatusMessage(`${FIELD_LABELS_TH.ERROR_SYNCING_DATA}: Sheet tab "${SHEET_NAME}" not found. Attempting to create.`);
        await setupSheetHeaders(token, spreadsheetIdToUse); 
        // It's crucial to reload after fixing headers.
        console.log("[App.tsx] loadMeasurementsFromSheet: Retrying loadMeasurementsFromSheet after potential sheet creation.");
        await loadMeasurementsFromSheet(token, spreadsheetIdToUse); // Recursive call to reload
        return;
      } else if (error.result?.error?.code === 403 && error.result?.error?.status === "PERMISSION_DENIED"){
         console.warn('[App.tsx] loadMeasurementsFromSheet: Permission denied for Google Sheets.');
         setStatusMessage(`${FIELD_LABELS_TH.ERROR_PERMISSION_DENIED_SHEETS}`);
         handleAuthClick(); // Prompt for re-authentication
      }
      else {
        setStatusMessage(`${FIELD_LABELS_TH.ERROR_SYNCING_DATA}: ${errorMessage}`);
        // Fallback to local storage if Sheets loading fails for other reasons
        console.warn('[App.tsx] loadMeasurementsFromSheet: Unhandled Sheets error, falling back to local storage.');
        updateUiBasedOnAuthState(null); // This will trigger local storage load
      }
    }
    setIsLoading(false);
  }, [gapiInited, setupSheetHeaders, isSignedIn, loadMeasurementsFromLocalStorage, updateUiBasedOnAuthState]);


  const handleSave = async (measurementToSave: CustomerMeasurement) => {
    console.log('[App.tsx] handleSave: Saving measurement:', measurementToSave);
    let finalMeasurement = { ...measurementToSave };
    if (!finalMeasurement.measurementDate) finalMeasurement.measurementDate = new Date().toISOString().split('T')[0];
    if (!finalMeasurement.id) finalMeasurement.id = Date.now().toString();

    if (!accessToken || !gapiInited || !userSpreadsheetId) {
      console.warn('[App.tsx] handleSave: Saving to local storage due to missing token, GAPI init, or spreadsheet ID.');
      setStatusMessage(FIELD_LABELS_TH.SAVING_TO_LOCAL_STORAGE_SIGN_IN_PROMPT);
      if (!isSignedIn) {
          console.log('[App.tsx] handleSave: User not signed in. Prompting for auth.');
          handleAuthClick(() => handleSave(measurementToSave)); // Pass the save action to be run after auth
          return;
      }
      // If signed in but other conditions fail (e.g. !userSpreadsheetId after GAPI init)
      setMeasurements(prev => {
        const existingIndex = prev.findIndex(m => m.id === finalMeasurement.id);
        let updatedMeasurements;
        if (existingIndex > -1) {
          updatedMeasurements = [...prev];
          updatedMeasurements[existingIndex] = finalMeasurement;
        } else {
          updatedMeasurements = [finalMeasurement, ...prev];
        }
        updatedMeasurements.sort((a,b) => (new Date(b.measurementDate || 0).getTime() - new Date(a.measurementDate || 0).getTime()));
        saveMeasurementsToLocalStorage(updatedMeasurements);
        return updatedMeasurements;
      });
      setCurrentView(ViewMode.List);
      setEditingMeasurement(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setStatusMessage(FIELD_LABELS_TH.SYNCING_DATA);
    try {
      const rowData = measurementToRow(finalMeasurement);
      if (finalMeasurement.rowIndex && finalMeasurement.id) { // Existing record, update it
        console.log(`[App.tsx] handleSave: Updating existing row ${finalMeasurement.rowIndex} in sheet.`);
        await window.gapi.client.sheets.spreadsheets.values.update({
          spreadsheetId: userSpreadsheetId,
          range: `${SHEET_NAME}!A${finalMeasurement.rowIndex}`,
          valueInputOption: 'USER_ENTERED',
          resource: { values: [rowData] },
        });
      } else { // New record, append it
        console.log(`[App.tsx] handleSave: Appending new row to sheet.`);
        const appendResponse = await window.gapi.client.sheets.spreadsheets.values.append({
          spreadsheetId: userSpreadsheetId,
          range: `${SHEET_NAME}!A1`, // Append after the last row with data in this sheet
          valueInputOption: 'USER_ENTERED',
          insertDataOption: 'INSERT_ROWS',
          resource: { values: [rowData] },
        });
        // Try to get the new rowIndex from the response to update the local object if needed.
        const updatedRange = appendResponse.result.updates?.updatedRange;
        if (updatedRange) {
          const match = updatedRange.match(/!A(\d+):/); // Example: 'Sheet1!A10:C10'
          if (match && match[1]) {
            finalMeasurement.rowIndex = parseInt(match[1], 10);
            console.log(`[App.tsx] handleSave: New row appended at rowIndex: ${finalMeasurement.rowIndex}`);
          }
        }
      }
      setStatusMessage(FIELD_LABELS_TH.SYNCED_WITH_GOOGLE_SHEETS);
      await loadMeasurementsFromSheet(accessToken, userSpreadsheetId); // Reload all data to ensure consistency
    } catch (error: any) {
      console.error('[App.tsx] handleSave: Error saving measurement to Google Sheets:', JSON.stringify(error, null, 2));
      setStatusMessage(`${FIELD_LABELS_TH.ERROR_SYNCING_DATA}: ${error.result?.error?.message || error.message}`);
      // Fallback or retry could be added here. For now, it shows an error and local data might be more current.
    }
    setCurrentView(ViewMode.List);
    setEditingMeasurement(null);
    setIsLoading(false);
  };

  const getSheetIdByTitle = async (spreadsheetFileId: string, sheetTitle: string): Promise<number | undefined> => {
    console.log(`[App.tsx] getSheetIdByTitle: Getting numeric sheetId for title "${sheetTitle}" in file "${spreadsheetFileId}"`);
    try {
        const response = await window.gapi.client.sheets.spreadsheets.get({
            spreadsheetId: spreadsheetFileId,
            fields: 'sheets(properties(sheetId,title))',
        });
        const sheet = response.result.sheets?.find(s => s.properties?.title === sheetTitle);
        if(sheet?.properties?.sheetId !== undefined) {
            console.log(`[App.tsx] getSheetIdByTitle: Found sheetId: ${sheet.properties.sheetId}`);
            return sheet.properties.sheetId;
        }
        console.warn(`[App.tsx] getSheetIdByTitle: Sheet with title "${sheetTitle}" not found.`);
        return undefined; 
    } catch (error) {
        console.error(`[App.tsx] getSheetIdByTitle: Error getting sheetId for title ${sheetTitle}:`, JSON.stringify(error, null, 2));
        return undefined; 
    }
  };

  const handleDelete = useCallback(async (id: string) => {
    console.log(`[App.tsx] handleDelete: Attempting to delete measurement with id: ${id}`);
    const measurementToDelete = measurements.find(m => m.id === id);
    if (!measurementToDelete) {
        console.warn(`[App.tsx] handleDelete: Measurement with id ${id} not found for deletion.`);
        return;
    }
    if (!window.confirm(FIELD_LABELS_TH.CONFIRM_DELETE_MESSAGE)) return;

    if (!accessToken || !gapiInited || !userSpreadsheetId || !measurementToDelete.rowIndex) {
      console.warn('[App.tsx] handleDelete: Deleting from local storage due to missing token, GAPI init, spreadsheet ID, or rowIndex.');
      setStatusMessage(FIELD_LABELS_TH.DELETING_FROM_LOCAL_STORAGE_SIGN_IN_PROMPT);
      if(!isSignedIn){
        console.log('[App.tsx] handleDelete: User not signed in. Prompting for auth.');
        handleAuthClick(() => handleDelete(id)); // Pass the delete action
        return;
      }
      const updatedLocalMeasurements = measurements.filter(m => m.id !== id);
      saveMeasurementsToLocalStorage(updatedLocalMeasurements);
      setMeasurements(updatedLocalMeasurements);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setStatusMessage(FIELD_LABELS_TH.SYNCING_DATA);
    try {
      const sheetNumericId = await getSheetIdByTitle(userSpreadsheetId, SHEET_NAME);
      if (sheetNumericId === undefined) {
        // This case should ideally not happen if sheet was created/found properly.
        throw new Error(`Could not find sheet ID for "${SHEET_NAME}" to delete row. Aborting delete.`);
      }
      console.log(`[App.tsx] handleDelete: Deleting row ${measurementToDelete.rowIndex} (0-indexed: ${measurementToDelete.rowIndex - 1}) from sheet with numericId ${sheetNumericId}.`);
      await window.gapi.client.sheets.spreadsheets.batchUpdate({
        spreadsheetId: userSpreadsheetId,
        resource: {
          requests: [{
            deleteDimension: {
              range: {
                sheetId: sheetNumericId,
                dimension: 'ROWS',
                startIndex: measurementToDelete.rowIndex - 1, // API is 0-indexed for startIndex
                endIndex: measurementToDelete.rowIndex,
              },
            },
          }],
        },
      });
      setStatusMessage(FIELD_LABELS_TH.SYNCED_WITH_GOOGLE_SHEETS);
      await loadMeasurementsFromSheet(accessToken, userSpreadsheetId); // Reload data
    } catch (error: any) {
      console.error('[App.tsx] handleDelete: Error deleting measurement from Google Sheets:', JSON.stringify(error, null, 2));
      setStatusMessage(`${FIELD_LABELS_TH.ERROR_SYNCING_DATA}: ${error.result?.error?.message || error.message || String(error)}`);
    }
    setIsLoading(false);
  }, [measurements, accessToken, gapiInited, userSpreadsheetId, loadMeasurementsFromSheet, isSignedIn]);


  const handleAddNew = () => {
    console.log('[App.tsx] handleAddNew: Navigating to form for new measurement.');
    setEditingMeasurement({ ...initialMeasurementState, id: '' }); // Ensure ID is empty for new
    setCurrentView(ViewMode.Form);
  };

  const handleEdit = (measurement: CustomerMeasurement) => {
    console.log('[App.tsx] handleEdit: Navigating to form to edit measurement:', measurement);
    setEditingMeasurement({ ...initialMeasurementState, ...measurement });
    setCurrentView(ViewMode.Form);
  };

  const handleCancelForm = () => {
    console.log('[App.tsx] handleCancelForm: Cancelling form, returning to list view.');
    setCurrentView(ViewMode.List);
    setEditingMeasurement(null);
  };

  // Sort measurements primarily by date (newest first), then by original sheet order (rowIndex) if dates are same
  const sortedMeasurements = [...measurements].sort((a,b) => {
    const dateA = new Date(a.measurementDate || 0).getTime();
    const dateB = new Date(b.measurementDate || 0).getTime();
    if (dateB !== dateA) return dateB - dateA; // Newest date first
    
    // If dates are the same, maintain original order from sheet if possible
    // Lower rowIndex means it appeared earlier in the sheet
    if(a.rowIndex && b.rowIndex && a.rowIndex !== b.rowIndex) return (a.rowIndex < b.rowIndex) ? -1 : 1; 
    
    // Fallback sort by ID if dates are same and rowIndex is not available or same
    if (a.id && b.id) return (a.id < b.id) ? -1 : 1; 
    return 0;
  });

  return (
    <div className="min-h-screen bg-slate-100 text-slate-800 py-8 px-4 md:px-8">
      <header className="text-center mb-6">
        <h1 className="text-4xl md:text-5xl font-bold text-sky-700">
          {FIELD_LABELS_TH.APP_TITLE}
        </h1>
      </header>

      <main className="container mx-auto max-w-7xl">
        <div className="mb-6 p-4 bg-sky-50 border border-sky-200 rounded-lg shadow-sm text-center">
          {(!gapiInited || !gisInited && !isSignedIn) && isLoading && <p className="text-lg text-sky-700">{FIELD_LABELS_TH.LOADING_APP_DATA} (Google API)...</p>}

          {gapiInited && gisInited && !isSignedIn && (
            <button
              onClick={() => handleAuthClick()}
              className="px-6 py-3 text-lg font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition duration-150 shadow-md"
              disabled={isLoading || !tokenClient}
            >
              {FIELD_LABELS_TH.SIGN_IN_WITH_GOOGLE}
            </button>
          )}
          {isSignedIn && (
            <button
              onClick={handleSignoutClick}
              className="px-6 py-3 text-lg font-semibold rounded-lg bg-slate-500 text-white hover:bg-slate-600 transition duration-150 shadow-md"
              disabled={isLoading && statusMessage !== FIELD_LABELS_TH.USING_LOCAL_STORAGE } 
            >
              {FIELD_LABELS_TH.SIGN_OUT_GOOGLE}
            </button>
          )}
          {statusMessage && <p className={`mt-3 text-md ${statusMessage.includes('Error') || statusMessage.includes('ข้อผิดพลาด') || statusMessage.includes('mismatch') || statusMessage.includes('Failed') ? 'text-red-600' : 'text-slate-700'}`}>{statusMessage}</p>}
           {isLoading && statusMessage !== FIELD_LABELS_TH.USING_LOCAL_STORAGE && <p className="text-sm text-sky-600 animate-pulse">{FIELD_LABELS_TH.LOADING_DATA}...</p>}
        </div>

        {currentView === ViewMode.List && (
          <MeasurementList
            measurements={sortedMeasurements}
            onAddNew={handleAddNew}
            onEdit={handleEdit}
            onDelete={handleDelete}
          />
        )}
        {currentView === ViewMode.Form && (
          <MeasurementForm
            onSave={handleSave}
            onCancel={handleCancelForm}
            existingMeasurement={editingMeasurement}
          />
        )}
      </main>

      <footer className="text-center mt-16 py-6 border-t border-slate-300">
        <p className="text-slate-500 text-lg">
          {FIELD_LABELS_TH.APP_TITLE} &copy; {new Date().getFullYear()}
        </p>
        <p className="text-slate-400 text-sm mt-1">
          {FIELD_LABELS_TH.FOOTER_SLOGAN}
        </p>
      </footer>
    </div>
  );
};

export default App;
