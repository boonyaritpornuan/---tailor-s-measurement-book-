
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

  const [isLoading, setIsLoading] = useState(true); // Initially true until GAPI/GIS attempt or fallback
  const [statusMessage, setStatusMessage] = useState<string | null>(FIELD_LABELS_TH.LOADING_APP_DATA);
  const [actionRequiresAuth, setActionRequiresAuth] = useState<(() => void) | null>(null);


  const loadMeasurementsFromLocalStorage = useCallback(() => {
    console.log('[App.tsx] loadMeasurementsFromLocalStorage: Loading data.');
    setIsLoading(true); // Ensure loading state is true before this sync operation
    try {
      const storedMeasurements = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (storedMeasurements) {
        const parsed = JSON.parse(storedMeasurements) as CustomerMeasurement[];
        setMeasurements(parsed.map(m => ({ ...initialMeasurementState, ...m })));
      } else {
        setMeasurements([]);
      }
      setStatusMessage(FIELD_LABELS_TH.USING_LOCAL_STORAGE);
    } catch (error) {
      console.error("[App.tsx] loadMeasurementsFromLocalStorage: Failed to load:", error);
      setMeasurements([]);
      setStatusMessage(FIELD_LABELS_TH.ERROR_LOADING_LOCAL_DATA);
    }
    setIsLoading(false);
  }, []);


  const findOrCreateUserSpreadsheet = useCallback(async (token: string) => {
    console.log('[App.tsx] findOrCreateUserSpreadsheet: Called.');
    if (!token || !gapiInited) {
        console.warn('[App.tsx] findOrCreateUserSpreadsheet: Aborted. Token or GAPI not ready.');
        setStatusMessage(FIELD_LABELS_TH.ERROR_GAPI_NOT_READY);
        setIsLoading(false);
        // Fallback handled by useEffect
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
        // StatusMessage will be updated by loadMeasurementsFromSheet
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
        await setupSheetHeaders(token, newFileId);
        await loadMeasurementsFromSheet(token, newFileId); 
      }
    } catch (error: any) {
      console.error('[App.tsx] findOrCreateUserSpreadsheet: Error:', JSON.stringify(error, null, 2));
      setStatusMessage(`${FIELD_LABELS_TH.ERROR_DRIVE_OPERATION}: ${error.result?.error?.message || error.message}`);
      setIsSignedIn(false); // Force sign out on critical Drive error
      setAccessToken(null);
      // Fallback to local storage will be triggered by useEffect due to isSignedIn change
    }
    // setIsLoading(false) is handled by loadMeasurementsFromSheet or error path
  }, [gapiInited]); // Removed loadMeasurementsFromSheet from deps to avoid circularity, it's called directly.


  // GIS Token Callback - simplified to set auth state
  const onTokenResponse = useCallback(async (tokenResponse: any) => {
    console.log('[App.tsx] onTokenResponse: Received tokenResponse:', tokenResponse);
    if (tokenResponse && tokenResponse.access_token) {
      console.log('[App.tsx] onTokenResponse: Access token received.');
      setAccessToken(tokenResponse.access_token);
      setIsSignedIn(true);
      // The main useEffect will handle GAPI init and data loading
      if (actionRequiresAuth) {
        console.log('[App.tsx] onTokenResponse: Executing pending actionRequiresAuth.');
        actionRequiresAuth();
        setActionRequiresAuth(null);
      }
    } else {
      console.error('[App.tsx] onTokenResponse: Token response error or access_token missing.', tokenResponse);
      setStatusMessage(FIELD_LABELS_TH.ERROR_AUTHENTICATING);
      setAccessToken(null);
      setIsSignedIn(false);
      // The main useEffect will handle fallback to local storage
    }
  }, [actionRequiresAuth]);


  // Effect for GAPI/GIS script loading
  useEffect(() => {
    console.log('[App.tsx] useEffect[]: Initializing Google API scripts.');
    setStatusMessage(FIELD_LABELS_TH.LOADING_APP_DATA + " (Google API)...");
    setIsLoading(true);

    const gapiScript = document.createElement('script');
    gapiScript.src = "https://apis.google.com/js/api.js";
    gapiScript.async = true;
    gapiScript.defer = true;
    gapiScript.onload = () => {
        console.log('[App.tsx] GAPI script loaded. Attempting to load "client" module.');
        if (window.gapi && typeof window.gapi.load === 'function') {
            window.gapi.load('client', () => {
                console.log('[App.tsx] gapi.load("client") CALLBACK FIRED. Calling initializeGapiClient.');
                initializeGapiClient();
            });
        } else {
            console.error('[App.tsx] GAPI script loaded, but window.gapi.load is not a function.');
            setStatusMessage(FIELD_LABELS_TH.ERROR_GAPI_LOAD_FUNCTION_NOT_FOUND);
            setGapiInited(false); // Ensure gapiInited is false
            setIsLoading(false); // Allow UI to show error and potentially fallback
        }
    };
    gapiScript.onerror = () => {
        console.error('[App.tsx] GAPI script FAILED to load.');
        setStatusMessage(FIELD_LABELS_TH.ERROR_GAPI_LOAD_FUNCTION_NOT_FOUND);
        setGapiInited(false);
        setIsLoading(false);
    };
    document.body.appendChild(gapiScript);

    const gisScript = document.createElement('script');
    gisScript.src = "https://accounts.google.com/gsi/client";
    gisScript.async = true;
    gisScript.defer = true;
    gisScript.onload = () => {
      console.log('[App.tsx] GIS script loaded. Initializing token client.');
      if (window.google?.accounts?.oauth2) {
        const client = window.google.accounts.oauth2.initTokenClient({
          client_id: GOOGLE_CLIENT_ID_FOR_SHEETS,
          scope: SCOPES,
          callback: onTokenResponse, // Use the memoized callback
        });
        setTokenClient(client);
        setGisInited(true);
         // If GAPI is already inited but we are not signed in, it means scripts are loaded, ready for user action.
        if (gapiInited && !isSignedIn) {
            setIsLoading(false); // Scripts loaded, ready for sign-in
            setStatusMessage(FIELD_LABELS_TH.USING_LOCAL_STORAGE); // Or a prompt to sign in
        } else if (!gapiInited && !isSignedIn) {
            // Still waiting for GAPI
        }
      } else {
        console.error('[App.tsx] GIS script loaded, but window.google.accounts.oauth2 not found.');
        setStatusMessage(FIELD_LABELS_TH.ERROR_GIS_NOT_READY);
        setGisInited(false);
        setIsLoading(false);
      }
    };
    gisScript.onerror = () => {
        console.error('[App.tsx] GIS script FAILED to load.');
        setStatusMessage(FIELD_LABELS_TH.ERROR_GIS_NOT_READY);
        setGisInited(false);
        setIsLoading(false);
    };
    document.body.appendChild(gisScript);

    return () => {
      console.log('[App.tsx] useEffect[] cleanup: Removing API scripts.');
      if (gapiScript.parentNode) gapiScript.parentNode.removeChild(gapiScript);
      if (gisScript.parentNode) gisScript.parentNode.removeChild(gisScript);
    };
  }, [onTokenResponse]); // initializeGapiClient is stable, onTokenResponse added.


  const initializeGapiClient = useCallback(async () => {
    console.log('[App.tsx] initializeGapiClient: Starting GAPI client initialization.');
    // Status is already "LOADING_APP_DATA..." or will be updated by main useEffect

    if (!window.gapi?.client?.init) {
        console.error('[App.tsx] initializeGapiClient: window.gapi.client.init is not available.');
        setStatusMessage(FIELD_LABELS_TH.ERROR_GAPI_CLIENT_INIT_NOT_FOUND);
        setGapiInited(false);
        setIsLoading(false);
        return;
    }

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
      // Main useEffect will now handle logic based on gapiInited becoming true
      // No need to set isLoading or statusMessage here, main useEffect will react.
    } catch (error: any) {
      console.timeEnd("gapiClientInit"); 
      console.error('[App.tsx] initializeGapiClient: Error initializing Google API client:', JSON.stringify(error, null, 2));
      let detailedErrorMessage = error.result?.error?.message || error.details || error.message || 'Unknown error';
      setStatusMessage(`${FIELD_LABELS_TH.ERROR_INITIALIZING_GAPI}: ${detailedErrorMessage}`);
      setGapiInited(false);
      setIsLoading(false); // Stop loading on GAPI init failure
    }
  }, []);


  // Main useEffect to handle data loading logic based on auth and GAPI state
  useEffect(() => {
    console.log(`[App.tsx] useEffect[isSignedIn,accessToken,gapiInited]: States - isSignedIn: ${isSignedIn}, accessToken: ${accessToken ? 'Exists' : 'Null'}, gapiInited: ${gapiInited}`);
    if (isSignedIn && accessToken && gapiInited) {
      console.log('[App.tsx] useEffect: All conditions met. Setting GAPI token and loading Google Drive data.');
      setIsLoading(true); // Set loading before async operation
      setStatusMessage(FIELD_LABELS_TH.AUTHENTICATED_INITIALIZING_APIS); // Or SYNCING_DATA
      if (window.gapi?.client) {
        window.gapi.client.setToken({ access_token: accessToken });
        findOrCreateUserSpreadsheet(accessToken);
      } else {
         console.error('[App.tsx] useEffect: isSignedIn, accessToken, gapiInited all true, but window.gapi.client not available!');
         setStatusMessage(FIELD_LABELS_TH.ERROR_GAPI_CLIENT_UNEXPECTED);
         setIsLoading(false);
      }
    } else if (!isSignedIn && (gisInited || !gisInited && !gapiInited)) { // If not signed in, and GIS is ready OR if both are not ready (initial load)
      console.log('[App.tsx] useEffect: Not signed in or scripts still loading. Using local storage.');
      if (window.gapi?.client) window.gapi.client.setToken(null);
      setUserSpreadsheetId(null);
      loadMeasurementsFromLocalStorage(); // This sets isLoading internally
    } else if (isSignedIn && accessToken && !gapiInited) {
      console.log('[App.tsx] useEffect: Signed in, token present, but GAPI not yet ready. Waiting...');
      setStatusMessage(FIELD_LABELS_TH.AUTHENTICATED_INITIALIZING_APIS);
      setIsLoading(true);
    } else if (!accessToken && isSignedIn && gapiInited) {
        console.warn('[App.tsx] useEffect: SignedIn is true, GAPI inited, but no accessToken. This state should ideally not happen or be transient. Falling back.');
        setIsSignedIn(false); // Correct the state
        // Fallback to local storage will be handled in the next render cycle of this useEffect
    } else if (!gapiInited && !gisInited && !isLoading) {
        // Scripts haven't loaded yet, but isLoading was potentially set to false by an error.
        // Ensure loading state reflects reality if scripts are still pending.
        console.log('[App.tsx] useEffect: Scripts not loaded, ensuring isLoading is true.');
        setIsLoading(true);
        setStatusMessage(FIELD_LABELS_TH.LOADING_APP_DATA + " (Google API)...");
    }
  }, [isSignedIn, accessToken, gapiInited, findOrCreateUserSpreadsheet, loadMeasurementsFromLocalStorage, gisInited]);


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
    // If already signed in and have a token, a prompt 'consent' might be needed
    // if you need to re-verify or get additional scopes. Otherwise, 'none' or '' for transparent.
    const promptValue = accessToken ? 'consent' : ''; 
    console.log(`[App.tsx] handleAuthClick: Requesting access token with prompt: '${promptValue}'`);
    tokenClient.requestAccessToken({ prompt: promptValue });
  };

  const handleSignoutClick = () => {
    console.log('[App.tsx] handleSignoutClick: Initiating sign-out.');
    const currentTokenToRevoke = accessToken; 
    if (currentTokenToRevoke && window.google?.accounts?.oauth2?.revoke) {
      console.log('[App.tsx] handleSignoutClick: Revoking token.');
      window.google.accounts.oauth2.revoke(currentTokenToRevoke, () => {
        console.log('[App.tsx] handleSignoutClick: Token revoked.');
        setAccessToken(null);
        setIsSignedIn(false);
        // Main useEffect will handle UI update and fallback to local storage
      });
    } else {
       console.warn('[App.tsx] handleSignoutClick: No token to revoke or GIS revoke not available.');
       setAccessToken(null);
       setIsSignedIn(false);
       // Main useEffect will handle UI update
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
        return; // Don't set loading false here, caller should manage
    }
    console.log(`[App.tsx] setupSheetHeaders: Attempting to set up sheet headers for sheet ID: ${spreadsheetIdToUse}`);
    // setIsLoading(true); // Loading state is managed by the caller (findOrCreate or loadMeasurements)
    // setStatusMessage(FIELD_LABELS_TH.SETTING_UP_SHEET_HEADERS);
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
        // setStatusMessage(FIELD_LABELS_TH.HEADERS_CONFIGURED_SUCCESS); // Let caller set final status
    } catch (error: any) {
        console.error('[App.tsx] setupSheetHeaders: Error setting up sheet headers:', JSON.stringify(error, null, 2));
        setStatusMessage(`${FIELD_LABELS_TH.ERROR_SETTING_UP_HEADERS}: ${error.result?.error?.message || 'Unknown error'}`);
        // setIsLoading(false); // Let caller manage
    }
  }, [gapiInited]);


  const loadMeasurementsFromSheet = useCallback(async (token: string | null, spreadsheetIdToUse: string | null) => {
    if (!token || !gapiInited || !spreadsheetIdToUse) {
      console.warn(`[App.tsx] loadMeasurementsFromSheet: Aborted. Conditions not met. isSignedIn: ${isSignedIn}, token: ${token ? 'Exists' : 'Null'}, gapiInited: ${gapiInited}, sheetId: ${spreadsheetIdToUse}`);
      setIsLoading(false);
      // Fallback to local storage will be handled by the main useEffect if isSignedIn becomes false
      return;
    }
    console.log(`[App.tsx] loadMeasurementsFromSheet: Loading data from sheet ID: ${spreadsheetIdToUse}`);
    setIsLoading(true); // Explicitly set loading true here
    setStatusMessage(FIELD_LABELS_TH.SYNCING_DATA);
    try {
      const response = await window.gapi.client.sheets.spreadsheets.values.get({
        spreadsheetId: spreadsheetIdToUse,
        range: `${SHEET_NAME}!A:AZ`, 
      });
      console.log('[App.tsx] loadMeasurementsFromSheet: Sheets values.get response:', response);
      const values = response.result.values;
      if (values && values.length > 0) { 
        const headerRow = values[0];
        if(JSON.stringify(headerRow) !== JSON.stringify(SHEET_FIELD_ORDER)) {
            console.warn("[App.tsx] loadMeasurementsFromSheet: Sheet header mismatch. Attempting to fix headers.");
            setStatusMessage(FIELD_LABELS_TH.ERROR_SHEET_HEADER_MISMATCH_ATTEMPT_FIX);
            await setupSheetHeaders(token, spreadsheetIdToUse);
            console.log("[App.tsx] loadMeasurementsFromSheet: Retrying loadMeasurementsFromSheet after header fix attempt.");
            await loadMeasurementsFromSheet(token, spreadsheetIdToUse); 
            return; 
        }
        const loadedMeasurements = values.slice(1)
          .map((row, index) => rowToMeasurement(row, index + 2)) 
          .filter(m => m.id); 
        setMeasurements(loadedMeasurements);
        setStatusMessage(loadedMeasurements.length > 0 ? FIELD_LABELS_TH.SYNCED_WITH_GOOGLE_SHEETS : FIELD_LABELS_TH.NO_RECORDS + ` (${FIELD_LABELS_TH.GOOGLE_SHEETS_STORAGE})`);
      } else { 
        console.log(`[App.tsx] loadMeasurementsFromSheet: No values found. Assuming empty sheet or needs headers.`);
        setMeasurements([]);
        // setStatusMessage(FIELD_LABELS_TH.NO_RECORDS + ` (${FIELD_LABELS_TH.GOOGLE_SHEETS_STORAGE}) - ${FIELD_LABELS_TH.ERROR_EMPTY_RESPONSE}`);
        await setupSheetHeaders(token, spreadsheetIdToUse); // Setup headers if sheet is empty
        setStatusMessage(FIELD_LABELS_TH.NO_RECORDS + ` (${FIELD_LABELS_TH.GOOGLE_SHEETS_STORAGE})`); // After setup, it's empty.
      }
    } catch (error: any) {
      console.error('[App.tsx] loadMeasurementsFromSheet: Error:', JSON.stringify(error, null, 2));
      const errorMessage = error.result?.error?.message || error.message || 'Unknown error';
      if (error.result?.error?.status === 'NOT_FOUND' || errorMessage.toLowerCase().includes('requested entity was not found') || (error.result?.error?.code === 400 && errorMessage.toLowerCase().includes('unable to parse range'))) {
        console.warn(`[App.tsx] loadMeasurementsFromSheet: Sheet tab "${SHEET_NAME}" likely not found. Attempting to create/fix headers.`);
        setStatusMessage(`${FIELD_LABELS_TH.ERROR_SYNCING_DATA}: Sheet "${SHEET_NAME}" not found. Creating.`);
        await setupSheetHeaders(token, spreadsheetIdToUse); 
        console.log("[App.tsx] loadMeasurementsFromSheet: Retrying load after sheet creation attempt.");
        await loadMeasurementsFromSheet(token, spreadsheetIdToUse); 
        return;
      } else if (error.result?.error?.code === 403 && error.result?.error?.status === "PERMISSION_DENIED"){
         console.warn('[App.tsx] loadMeasurementsFromSheet: Permission denied.');
         setStatusMessage(`${FIELD_LABELS_TH.ERROR_PERMISSION_DENIED_SHEETS}`);
         // Re-authentication might be needed. Prompt user.
         // This might involve revoking token and asking to sign in again if consent is stale.
         handleAuthClick(); 
      }
      else {
        setStatusMessage(`${FIELD_LABELS_TH.ERROR_SYNCING_DATA}: ${errorMessage}`);
        console.warn('[App.tsx] loadMeasurementsFromSheet: Unhandled Sheets error. Consider fallback.');
        setIsSignedIn(false); // Force sign-out on unhandled error to trigger local storage via useEffect
        setAccessToken(null);
      }
    }
    setIsLoading(false);
  }, [gapiInited, setupSheetHeaders, isSignedIn]); // isSignedIn added to re-evaluate if it changes externally


  const handleSave = async (measurementToSave: CustomerMeasurement) => {
    console.log('[App.tsx] handleSave: Saving measurement:', measurementToSave);
    let finalMeasurement = { ...measurementToSave };
    if (!finalMeasurement.measurementDate) finalMeasurement.measurementDate = new Date().toISOString().split('T')[0];
    if (!finalMeasurement.id) finalMeasurement.id = Date.now().toString();

    if (!accessToken || !gapiInited || !userSpreadsheetId || !isSignedIn) {
      console.warn('[App.tsx] handleSave: Conditions not met for Google Sheets save. Using local storage.');
      setStatusMessage(FIELD_LABELS_TH.SAVING_TO_LOCAL_STORAGE_SIGN_IN_PROMPT);
      if (!isSignedIn && tokenClient) { // tokenClient check to ensure GIS is ready for auth prompt
          console.log('[App.tsx] handleSave: User not signed in. Prompting for auth.');
          handleAuthClick(() => handleSave(measurementToSave)); 
          return;
      }
      // If signed in but other conditions (gapi, sheetId) fail, or if no tokenClient to prompt
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
      if (finalMeasurement.rowIndex && finalMeasurement.id) { 
        console.log(`[App.tsx] handleSave: Updating existing row ${finalMeasurement.rowIndex} in sheet.`);
        await window.gapi.client.sheets.spreadsheets.values.update({
          spreadsheetId: userSpreadsheetId,
          range: `${SHEET_NAME}!A${finalMeasurement.rowIndex}`,
          valueInputOption: 'USER_ENTERED',
          resource: { values: [rowData] },
        });
      } else { 
        console.log(`[App.tsx] handleSave: Appending new row to sheet.`);
        const appendResponse = await window.gapi.client.sheets.spreadsheets.values.append({
          spreadsheetId: userSpreadsheetId,
          range: `${SHEET_NAME}!A1`, 
          valueInputOption: 'USER_ENTERED',
          insertDataOption: 'INSERT_ROWS',
          resource: { values: [rowData] },
        });
        const updatedRange = appendResponse.result.updates?.updatedRange;
        if (updatedRange) {
          const match = updatedRange.match(/!A(\d+):/); 
          if (match && match[1]) {
            finalMeasurement.rowIndex = parseInt(match[1], 10);
            console.log(`[App.tsx] handleSave: New row appended at rowIndex: ${finalMeasurement.rowIndex}`);
          }
        }
      }
      setStatusMessage(FIELD_LABELS_TH.SYNCED_WITH_GOOGLE_SHEETS);
      await loadMeasurementsFromSheet(accessToken, userSpreadsheetId); 
    } catch (error: any) {
      console.error('[App.tsx] handleSave: Error saving measurement to Google Sheets:', JSON.stringify(error, null, 2));
      setStatusMessage(`${FIELD_LABELS_TH.ERROR_SYNCING_DATA}: ${error.result?.error?.message || error.message}`);
      // Don't necessarily sign out, let user retry or fix issue. Local save already happened if this path was chosen.
    }
    setCurrentView(ViewMode.List);
    setEditingMeasurement(null);
    setIsLoading(false);
  };

  const getSheetIdByTitle = async (spreadsheetFileId: string, sheetTitle: string): Promise<number | undefined> => {
    console.log(`[App.tsx] getSheetIdByTitle: Getting numeric sheetId for title "${sheetTitle}" in file "${spreadsheetFileId}"`);
    if(!gapiInited || !window.gapi?.client?.sheets) return undefined; // Guard
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

    if (!accessToken || !gapiInited || !userSpreadsheetId || !measurementToDelete.rowIndex || !isSignedIn) {
      console.warn('[App.tsx] handleDelete: Conditions not met for Google Sheets delete. Using local storage.');
      setStatusMessage(FIELD_LABELS_TH.DELETING_FROM_LOCAL_STORAGE_SIGN_IN_PROMPT);
      if(!isSignedIn && tokenClient){ // tokenClient check for auth readiness
        console.log('[App.tsx] handleDelete: User not signed in. Prompting for auth.');
        handleAuthClick(() => handleDelete(id)); 
        return;
      }
      const updatedLocalMeasurements = measurements.filter(m => m.id !== id);
      saveMeasurementsToLocalStorage(updatedLocalMeasurements);
      setMeasurements(updatedLocalMeasurements);
      if (updatedLocalMeasurements.length === 0) setStatusMessage(FIELD_LABELS_TH.NO_RECORDS);
      else setStatusMessage(FIELD_LABELS_TH.USING_LOCAL_STORAGE); // Or a success delete message
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setStatusMessage(FIELD_LABELS_TH.SYNCING_DATA);
    try {
      const sheetNumericId = await getSheetIdByTitle(userSpreadsheetId, SHEET_NAME);
      if (sheetNumericId === undefined) {
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
                startIndex: measurementToDelete.rowIndex - 1, 
                endIndex: measurementToDelete.rowIndex,
              },
            },
          }],
        },
      });
      setStatusMessage(FIELD_LABELS_TH.SYNCED_WITH_GOOGLE_SHEETS); // Or "Deleted successfully"
      await loadMeasurementsFromSheet(accessToken, userSpreadsheetId); 
    } catch (error: any) {
      console.error('[App.tsx] handleDelete: Error deleting measurement from Google Sheets:', JSON.stringify(error, null, 2));
      setStatusMessage(`${FIELD_LABELS_TH.ERROR_SYNCING_DATA}: ${error.result?.error?.message || error.message || String(error)}`);
    }
    setIsLoading(false);
  }, [measurements, accessToken, gapiInited, userSpreadsheetId, loadMeasurementsFromSheet, isSignedIn, tokenClient]);


  const handleAddNew = () => {
    console.log('[App.tsx] handleAddNew: Navigating to form for new measurement.');
    setEditingMeasurement({ ...initialMeasurementState, id: '' }); 
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

  const sortedMeasurements = [...measurements].sort((a,b) => {
    const dateA = new Date(a.measurementDate || 0).getTime();
    const dateB = new Date(b.measurementDate || 0).getTime();
    if (dateB !== dateA) return dateB - dateA; 
    if(a.rowIndex && b.rowIndex && a.rowIndex !== b.rowIndex) return (a.rowIndex < b.rowIndex) ? -1 : 1; 
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
          {/* Auth Buttons and Status */}
          {(!gisInited || !gapiInited) && isLoading && 
            <p className="text-lg text-sky-700 animate-pulse">{FIELD_LABELS_TH.LOADING_APP_DATA} (Google API)...</p>
          }

          {gisInited && gapiInited && !isSignedIn && (
            <button
              onClick={() => handleAuthClick()}
              className="px-6 py-3 text-lg font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition duration-150 shadow-md"
              disabled={isLoading || !tokenClient} // Disable if still loading or tokenClient not ready
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
          {statusMessage && <p className={`mt-3 text-md ${statusMessage.includes('Error') || statusMessage.includes('ข้อผิดพลาด') || statusMessage.includes('mismatch') || statusMessage.includes('Failed') || statusMessage.includes('ไม่พบ') ? 'text-red-600' : 'text-slate-700'}`}>{statusMessage}</p>}
           {isLoading && statusMessage !== FIELD_LABELS_TH.USING_LOCAL_STORAGE && (!gisInited || !gapiInited) && <p className="text-sm text-sky-600 animate-pulse">{FIELD_LABELS_TH.LOADING_DATA}...</p>}
           {isLoading && (isSignedIn || statusMessage === FIELD_LABELS_TH.SYNCING_DATA || statusMessage === FIELD_LABELS_TH.AUTHENTICATED_SEARCHING_SHEET || statusMessage === FIELD_LABELS_TH.AUTHENTICATED_INITIALIZING_APIS ) && <p className="text-sm text-sky-600 animate-pulse">{FIELD_LABELS_TH.LOADING_DATA}...</p>}
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
    
