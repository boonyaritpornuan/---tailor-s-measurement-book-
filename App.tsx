
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
    setIsLoading(true); 
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
      setIsSignedIn(false); 
      setAccessToken(null);
    }
  }, [gapiInited]);


  const onTokenResponse = useCallback(async (tokenResponse: any) => {
    console.log('[App.tsx] onTokenResponse: Received tokenResponse:', tokenResponse);
    if (tokenResponse && tokenResponse.access_token) {
      console.log('[App.tsx] onTokenResponse: Access token received.');
      setAccessToken(tokenResponse.access_token);
      setIsSignedIn(true);
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
    }
  }, [actionRequiresAuth]);


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
            setGapiInited(false); 
            setIsLoading(false); 
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
          callback: onTokenResponse, 
        });
        setTokenClient(client);
        setGisInited(true);
        if (gapiInited && !isSignedIn) {
            setIsLoading(false); 
            setStatusMessage(FIELD_LABELS_TH.USING_LOCAL_STORAGE); 
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
  }, [onTokenResponse]);


  const initializeGapiClient = useCallback(async () => {
    console.log('[App.tsx] initializeGapiClient: Starting GAPI client initialization.');
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
    } catch (error: any) {
      console.timeEnd("gapiClientInit"); 
      console.error('[App.tsx] initializeGapiClient: Error initializing Google API client:', JSON.stringify(error, null, 2));
      let detailedErrorMessage = error.result?.error?.message || error.details || error.message || 'Unknown error';
      setStatusMessage(`${FIELD_LABELS_TH.ERROR_INITIALIZING_GAPI}: ${detailedErrorMessage}`);
      setGapiInited(false);
      setIsLoading(false); 
    }
  }, []);


  useEffect(() => {
    console.log(`[App.tsx] useEffect[isSignedIn,accessToken,gapiInited]: States - isSignedIn: ${isSignedIn}, accessToken: ${accessToken ? 'Exists' : 'Null'}, gapiInited: ${gapiInited}`);
    if (isSignedIn && accessToken && gapiInited) {
      console.log('[App.tsx] useEffect: All conditions met. Setting GAPI token and loading Google Drive data.');
      setIsLoading(true); 
      setStatusMessage(FIELD_LABELS_TH.AUTHENTICATED_INITIALIZING_APIS); 
      if (window.gapi?.client) {
        window.gapi.client.setToken({ access_token: accessToken });
        findOrCreateUserSpreadsheet(accessToken);
      } else {
         console.error('[App.tsx] useEffect: isSignedIn, accessToken, gapiInited all true, but window.gapi.client not available!');
         setStatusMessage(FIELD_LABELS_TH.ERROR_GAPI_CLIENT_UNEXPECTED);
         setIsLoading(false);
      }
    } else if (!isSignedIn && (gisInited || !gisInited && !gapiInited)) { 
      console.log('[App.tsx] useEffect: Not signed in or scripts still loading. Using local storage.');
      if (window.gapi?.client) window.gapi.client.setToken(null);
      setUserSpreadsheetId(null);
      loadMeasurementsFromLocalStorage(); 
    } else if (isSignedIn && accessToken && !gapiInited) {
      console.log('[App.tsx] useEffect: Signed in, token present, but GAPI not yet ready. Waiting...');
      setStatusMessage(FIELD_LABELS_TH.AUTHENTICATED_INITIALIZING_APIS);
      setIsLoading(true);
    } else if (!accessToken && isSignedIn && gapiInited) {
        console.warn('[App.tsx] useEffect: SignedIn is true, GAPI inited, but no accessToken. This state should ideally not happen or be transient. Falling back.');
        setIsSignedIn(false); 
    } else if (!gapiInited && !gisInited && !isLoading) {
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
      });
    } else {
       console.warn('[App.tsx] handleSignoutClick: No token to revoke or GIS revoke not available.');
       setAccessToken(null);
       setIsSignedIn(false);
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
    } catch (error: any) {
        console.error('[App.tsx] setupSheetHeaders: Error setting up sheet headers:', JSON.stringify(error, null, 2));
        setStatusMessage(`${FIELD_LABELS_TH.ERROR_SETTING_UP_HEADERS}: ${error.result?.error?.message || 'Unknown error'}`);
    }
  }, [gapiInited]);


  const loadMeasurementsFromSheet = useCallback(async (token: string | null, spreadsheetIdToUse: string | null) => {
    if (!token || !gapiInited || !spreadsheetIdToUse) {
      console.warn(`[App.tsx] loadMeasurementsFromSheet: Aborted. Conditions not met. isSignedIn: ${isSignedIn}, token: ${token ? 'Exists' : 'Null'}, gapiInited: ${gapiInited}, sheetId: ${spreadsheetIdToUse}`);
      setIsLoading(false);
      return;
    }
    console.log(`[App.tsx] loadMeasurementsFromSheet: Loading data from sheet ID: ${spreadsheetIdToUse}`);
    setIsLoading(true); 
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
        await setupSheetHeaders(token, spreadsheetIdToUse); 
        setStatusMessage(FIELD_LABELS_TH.NO_RECORDS + ` (${FIELD_LABELS_TH.GOOGLE_SHEETS_STORAGE})`); 
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
         handleAuthClick(); 
      }
      else {
        setStatusMessage(`${FIELD_LABELS_TH.ERROR_SYNCING_DATA}: ${errorMessage}`);
        console.warn('[App.tsx] loadMeasurementsFromSheet: Unhandled Sheets error. Consider fallback.');
        setIsSignedIn(false); 
        setAccessToken(null);
      }
    }
    setIsLoading(false);
  }, [gapiInited, setupSheetHeaders, isSignedIn]); 


  const handleSave = async (measurementToSave: CustomerMeasurement) => {
    console.log('[App.tsx] handleSave: Initiating save for measurement ID:', measurementToSave.id);
    setIsLoading(true); // Set loading at the beginning of the save operation

    let finalMeasurement = { ...measurementToSave };
    if (!finalMeasurement.measurementDate) finalMeasurement.measurementDate = new Date().toISOString().split('T')[0];
    if (!finalMeasurement.id) finalMeasurement.id = Date.now().toString();

    console.log(`[App.tsx] handleSave: Conditions check:
      isSignedIn: ${isSignedIn},
      accessToken: ${accessToken ? 'Exists' : 'Null'},
      gapiInited: ${gapiInited},
      userSpreadsheetId: ${userSpreadsheetId || 'Null'}`);

    if (!isSignedIn || !accessToken || !gapiInited || !userSpreadsheetId) {
      console.warn('[App.tsx] handleSave: Conditions for Google Sheets save NOT MET. Using local storage.');
      setStatusMessage(FIELD_LABELS_TH.SAVING_TO_LOCAL_STORAGE_SIGN_IN_PROMPT);
      
      if (!isSignedIn && tokenClient) {
          console.log('[App.tsx] handleSave: User not signed in and tokenClient available. Prompting for auth then retrying save.');
          setActionRequiresAuth(() => () => handleSave(finalMeasurement)); // Chain the save action
          handleAuthClick(); // This will set actionRequiresAuth and then call it on success
          // Don't set isLoading false here, as auth flow is pending
          return;
      }
      
      // Fallback to local storage if not signed in AND no tokenClient, or if other conditions fail.
      console.log('[App.tsx] handleSave: Proceeding with local storage save.');
      setMeasurements(prev => {
        const existingIndex = prev.findIndex(m => m.id === finalMeasurement.id);
        let updatedMeasurements;
        if (existingIndex > -1) {
          console.log(`[App.tsx] handleSave (Local): Updating existing local measurement ID: ${finalMeasurement.id}`);
          updatedMeasurements = [...prev];
          updatedMeasurements[existingIndex] = finalMeasurement;
        } else {
          console.log(`[App.tsx] handleSave (Local): Adding new local measurement ID: ${finalMeasurement.id}`);
          updatedMeasurements = [finalMeasurement, ...prev];
        }
        updatedMeasurements.sort((a,b) => (new Date(b.measurementDate || 0).getTime() - new Date(a.measurementDate || 0).getTime()));
        saveMeasurementsToLocalStorage(updatedMeasurements);
        return updatedMeasurements;
      });
      setCurrentView(ViewMode.List);
      setEditingMeasurement(null);
      setStatusMessage(FIELD_LABELS_TH.USING_LOCAL_STORAGE + ' (บันทึกสำเร็จในเครื่อง)');
      setIsLoading(false);
      return;
    }

    console.log('[App.tsx] handleSave: Conditions for Google Sheets save MET. Proceeding with Sheets operation.');
    setStatusMessage(FIELD_LABELS_TH.SYNCING_DATA + ' (กำลังบันทึก...)');
    try {
      const rowData = measurementToRow(finalMeasurement);
      console.log('[App.tsx] handleSave (Sheets): Data to be saved/updated:', rowData);
      console.log('[App.tsx] handleSave (Sheets): Measurement rowIndex:', finalMeasurement.rowIndex);

      if (finalMeasurement.rowIndex && finalMeasurement.id) { 
        console.log(`[App.tsx] handleSave (Sheets): Attempting to UPDATE existing row ${finalMeasurement.rowIndex} in sheet ID ${userSpreadsheetId}. Range: ${SHEET_NAME}!A${finalMeasurement.rowIndex}`);
        const updateResponse = await window.gapi.client.sheets.spreadsheets.values.update({
          spreadsheetId: userSpreadsheetId,
          range: `${SHEET_NAME}!A${finalMeasurement.rowIndex}`, // Assuming ID is in column A and determines the start.
          valueInputOption: 'USER_ENTERED',
          resource: { values: [rowData] },
        });
        console.log('[App.tsx] handleSave (Sheets): Update response:', updateResponse);
      } else { 
        console.log(`[App.tsx] handleSave (Sheets): Attempting to APPEND new row to sheet ID ${userSpreadsheetId}.`);
        const appendResponse = await window.gapi.client.sheets.spreadsheets.values.append({
          spreadsheetId: userSpreadsheetId,
          range: `${SHEET_NAME}!A1`, 
          valueInputOption: 'USER_ENTERED',
          insertDataOption: 'INSERT_ROWS',
          resource: { values: [rowData] },
        });
        console.log('[App.tsx] handleSave (Sheets): Append response:', appendResponse);
        const updatedRange = appendResponse.result.updates?.updatedRange;
        if (updatedRange) {
          const match = updatedRange.match(/!A(\d+):/); // Example: 'CustomerData!A10:AK10' -> extracts 10
          if (match && match[1]) {
            finalMeasurement.rowIndex = parseInt(match[1], 10);
            console.log(`[App.tsx] handleSave (Sheets): New row appended. Extracted rowIndex: ${finalMeasurement.rowIndex} from range ${updatedRange}`);
          } else {
             console.warn(`[App.tsx] handleSave (Sheets): Could not extract rowIndex from updatedRange: ${updatedRange}. Reloading all data to ensure consistency.`);
          }
        } else {
            console.warn(`[App.tsx] handleSave (Sheets): Append response did not contain updatedRange. Full reload will be needed.`);
        }
      }
      setStatusMessage(FIELD_LABELS_TH.SYNCED_WITH_GOOGLE_SHEETS + ' (บันทึกสำเร็จ)');
      console.log('[App.tsx] handleSave (Sheets): Save successful. Reloading all measurements from sheet.');
      await loadMeasurementsFromSheet(accessToken, userSpreadsheetId); 
    } catch (error: any) {
      console.error('[App.tsx] handleSave (Sheets): Error saving measurement to Google Sheets:', JSON.stringify(error, null, 2));
      const errMessage = error.result?.error?.message || error.message || 'Unknown error during save';
      setStatusMessage(`${FIELD_LABELS_TH.ERROR_SYNCING_DATA}: ${errMessage}`);
      // Consider not changing view or editingMeasurement if save fails, allowing user to retry.
      // Or, provide a clear "retry" option. For now, it falls through and sets isLoading false.
    }
    setCurrentView(ViewMode.List);
    setEditingMeasurement(null);
    setIsLoading(false);
  };

  const getSheetIdByTitle = async (spreadsheetFileId: string, sheetTitle: string): Promise<number | undefined> => {
    console.log(`[App.tsx] getSheetIdByTitle: Getting numeric sheetId for title "${sheetTitle}" in file "${spreadsheetFileId}"`);
    if(!gapiInited || !window.gapi?.client?.sheets) return undefined; 
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

    setIsLoading(true); 

    if (!isSignedIn || !accessToken || !gapiInited || !userSpreadsheetId || !measurementToDelete.rowIndex) {
      console.warn('[App.tsx] handleDelete: Conditions for Google Sheets delete NOT MET. Using local storage.');
      setStatusMessage(FIELD_LABELS_TH.DELETING_FROM_LOCAL_STORAGE_SIGN_IN_PROMPT);
      
      if(!isSignedIn && tokenClient){ 
        console.log('[App.tsx] handleDelete: User not signed in. Prompting for auth.');
        setActionRequiresAuth(() => () => handleDelete(id));
        handleAuthClick(); 
        return;
      }

      const updatedLocalMeasurements = measurements.filter(m => m.id !== id);
      saveMeasurementsToLocalStorage(updatedLocalMeasurements);
      setMeasurements(updatedLocalMeasurements);
      if (updatedLocalMeasurements.length === 0) setStatusMessage(FIELD_LABELS_TH.NO_RECORDS);
      else setStatusMessage(FIELD_LABELS_TH.USING_LOCAL_STORAGE + ' (ลบสำเร็จในเครื่อง)'); 
      setIsLoading(false);
      return;
    }

    console.log('[App.tsx] handleDelete: Conditions for Google Sheets delete MET. Proceeding.');
    setStatusMessage(FIELD_LABELS_TH.SYNCING_DATA + ' (กำลังลบ...)');
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
      setStatusMessage(FIELD_LABELS_TH.SYNCED_WITH_GOOGLE_SHEETS + ' (ลบสำเร็จ)'); 
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
          {(!gisInited || !gapiInited) && isLoading && 
            <p className="text-lg text-sky-700 animate-pulse">{FIELD_LABELS_TH.LOADING_APP_DATA} (Google API)...</p>
          }

          {gisInited && gapiInited && !isSignedIn && (
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
