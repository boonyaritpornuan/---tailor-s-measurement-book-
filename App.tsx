
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
      console.error("Failed to load measurements from localStorage:", error);
      setMeasurements([]);
       setStatusMessage(FIELD_LABELS_TH.ERROR_LOADING_LOCAL_DATA);
    }
    setIsLoading(false);
  }, []);


  const findOrCreateUserSpreadsheet = useCallback(async (token: string) => {
    if (!token || !gapiInited) { // gapiInited check is important here
        setStatusMessage(FIELD_LABELS_TH.ERROR_GAPI_NOT_READY);
        setIsLoading(false);
        return;
    }
    setIsLoading(true);
    setStatusMessage(FIELD_LABELS_TH.AUTHENTICATED_SEARCHING_SHEET);
    try {
      const driveResponse = await window.gapi.client.drive.files.list({
        q: `name='${USER_SPREADSHEET_FILENAME}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`,
        fields: 'files(id, name)',
        spaces: 'drive',
      });

      if (driveResponse.result.files && driveResponse.result.files.length > 0) {
        const foundFileId = driveResponse.result.files[0].id;
        setUserSpreadsheetId(foundFileId);
        setStatusMessage(FIELD_LABELS_TH.SPREADSHEET_FOUND_LOADING_DATA);
        await loadMeasurementsFromSheet(token, foundFileId);
      } else {
        setStatusMessage(FIELD_LABELS_TH.SPREADSHEET_NOT_FOUND_CREATING);
        const createResponse = await window.gapi.client.drive.files.create({
          resource: {
            name: USER_SPREADSHEET_FILENAME,
            mimeType: 'application/vnd.google-apps.spreadsheet',
          },
          fields: 'id',
        });
        const newFileId = createResponse.result.id;
        setUserSpreadsheetId(newFileId);
        setStatusMessage(FIELD_LABELS_TH.SPREADSHEET_CREATED_SETUP_HEADERS);
        await setupSheetHeaders(token, newFileId);
        await loadMeasurementsFromSheet(token, newFileId);
      }
    } catch (error: any) {
      console.error('Error finding or creating spreadsheet:', error);
      setStatusMessage(`${FIELD_LABELS_TH.ERROR_DRIVE_OPERATION}: ${error.result?.error?.message || error.message}`);
      await updateUiBasedOnAuthState(null); // Fallback to local storage
    }
    setIsLoading(false);
  }, [gapiInited]); // Removed loadMeasurementsFromSheet and setupSheetHeaders, they are called internally.
                      // Added updateUiBasedOnAuthState below, if it's safe.
                      // Re-evaluating: findOrCreateUserSpreadsheet depends on gapiInited.
                      // It calls loadMeasurementsFromSheet and setupSheetHeaders which also need token & gapiInited.
                      // If updateUiBasedOnAuthState is a dependency, it creates a loop.
                      // Let's keep findOrCreateUserSpreadsheet independent of updateUiBasedOnAuthState.

  const updateUiBasedOnAuthState = useCallback(async (newAccessToken: string | null) => {
    if (newAccessToken !== accessToken) {
        setAccessToken(newAccessToken);
    }

    const tokenToUse = newAccessToken;

    if (tokenToUse && gapiInited) {
      const currentGapiToken = window.gapi?.client?.getToken?.();
      if (!currentGapiToken || currentGapiToken.access_token !== tokenToUse) {
        if (window.gapi?.client) {
            window.gapi.client.setToken({ access_token: tokenToUse });
        } else {
            console.warn("gapiInited is true, but gapi.client is not available to setToken.");
            setIsSignedIn(false);
            setStatusMessage("Error: Google API client not fully ready despite indication.");
            loadMeasurementsFromLocalStorage(); // Fallback
            return;
        }
      }
      setIsSignedIn(true);
      // No need to set status message here, findOrCreateUserSpreadsheet will do it
      await findOrCreateUserSpreadsheet(tokenToUse);
    } else if (tokenToUse && !gapiInited) {
      // Token received (likely from GIS), but GAPI client (gapi.client.init) hasn't finished.
      // The accessToken state IS set (or will be by the if block above).
      // initializeGapiClient will eventually set gapiInited and re-evaluate using the accessToken state.
      setIsSignedIn(true); // Tentatively true, as Google auth happened
      setStatusMessage("Authenticated with Google. Initializing API services...");
      setIsLoading(true);
    } else { // No token (tokenToUse is null)
      setIsSignedIn(false);
      setUserSpreadsheetId(null);
      if (window.gapi?.client) {
         window.gapi.client.setToken(null);
      }
      setStatusMessage(FIELD_LABELS_TH.USING_LOCAL_STORAGE);
      loadMeasurementsFromLocalStorage();
    }
  }, [gapiInited, accessToken, loadMeasurementsFromLocalStorage, findOrCreateUserSpreadsheet]);


  useEffect(() => {
    setStatusMessage(FIELD_LABELS_TH.LOADING_APP_DATA + " (Google API)...");
    const gapiScript = document.createElement('script');
    gapiScript.src = "https://apis.google.com/js/api.js";
    gapiScript.async = true;
    gapiScript.defer = true;
    gapiScript.onload = () => window.gapi.load('client', initializeGapiClient);
    document.body.appendChild(gapiScript);

    const gisScript = document.createElement('script');
    gisScript.src = "https://accounts.google.com/gsi/client";
    gisScript.async = true;
    gisScript.defer = true;
    gisScript.onload = () => {
      setGisInited(true);
      const client = window.google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID_FOR_SHEETS,
        scope: SCOPES,
        callback: async (tokenResponse: any) => {
          if (tokenResponse && tokenResponse.access_token) {
            await updateUiBasedOnAuthState(tokenResponse.access_token);
             if (actionRequiresAuth) {
              actionRequiresAuth();
              setActionRequiresAuth(null);
            }
          } else {
            console.error('Token response error or access_token missing.', tokenResponse);
            setStatusMessage(FIELD_LABELS_TH.ERROR_AUTHENTICATING);
            await updateUiBasedOnAuthState(null);
          }
        },
      });
      setTokenClient(client);
      if(gapiInited && !accessToken) { // If GAPI already loaded and we have no token
        updateUiBasedOnAuthState(null);
      } else if (!gapiInited && !accessToken) { // Neither ready, no token, ensure loading state is accurate
        setStatusMessage(FIELD_LABELS_TH.LOADING_APP_DATA + " (Google API)...");
        setIsLoading(true);
      }
    };
    document.body.appendChild(gisScript);

    return () => {
      if (gapiScript.parentNode) gapiScript.parentNode.removeChild(gapiScript);
      if (gisScript.parentNode) gisScript.parentNode.removeChild(gisScript);
    };
  }, []); // initializeGapiClient, updateUiBasedOnAuthState, accessToken are not stable, so keep this empty.
           // This effect is for one-time script loading.

  const initializeGapiClient = useCallback(async () => {
    try {
      await window.gapi.client.init({
        discoveryDocs: [
          'https://sheets.googleapis.com/$discovery/rest?version=v4',
          'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest',
        ],
      });
      setGapiInited(true); // GAPI is now ready

      const gapiTokenInfo = window.gapi.client.getToken?.();
      const currentToken = gapiTokenInfo?.access_token || accessToken; // Check GAPI's token, then React state

      // Call updateUiBasedOnAuthState with the determined token.
      // If currentToken is null, it will set to local storage mode.
      // If currentToken exists, and gapiInited is now true, it will proceed.
      await updateUiBasedOnAuthState(currentToken);

    } catch (error: any) {
      console.error('Error initializing Google API client:', error);
      setStatusMessage(`${FIELD_LABELS_TH.ERROR_INITIALIZING_GAPI}: ${error.details || error.message || 'Unknown error'}`);
      setGapiInited(false); // Explicitly set to false on error
      setIsLoading(false); // Ensure loading is stopped
      await updateUiBasedOnAuthState(null); // Fallback to local storage mode
    }
  }, [accessToken, updateUiBasedOnAuthState]); // updateUiBasedOnAuthState depends on accessToken


  const handleAuthClick = (callback?: () => void) => {
    if (!tokenClient) {
        setStatusMessage(FIELD_LABELS_TH.ERROR_GIS_NOT_READY);
        return;
    }
    if (callback) {
        setActionRequiresAuth(() => callback);
    }
    if (accessToken) { // If user is already signed in (has token) but wants to re-auth (e.g. for consent)
        tokenClient.requestAccessToken({ prompt: 'consent' });
    } else { // Standard sign-in flow
        tokenClient.requestAccessToken({ prompt: '' });
    }
  };

  const handleSignoutClick = () => {
    const currentTokenToRevoke = accessToken;
    if (currentTokenToRevoke && window.google?.accounts?.oauth2) { // Check if google.accounts.oauth2 exists
      window.google.accounts.oauth2.revoke(currentTokenToRevoke, async () => {
        // Token revoked. updateUiBasedOnAuthState(null) will clear gapi token, react state, and load local.
        await updateUiBasedOnAuthState(null);
      });
    } else {
       // No token to revoke, or GIS not fully loaded, but ensure UI is in signed-out state
       updateUiBasedOnAuthState(null);
    }
  };

  const saveMeasurementsToLocalStorage = (currentMeasurements: CustomerMeasurement[]) => {
    try {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(currentMeasurements));
    } catch (error) {
      console.error("Failed to save measurements to localStorage:", error);
       setStatusMessage(FIELD_LABELS_TH.ERROR_SAVING_LOCAL_DATA);
    }
  };

  const setupSheetHeaders = useCallback(async (token: string | null, spreadsheetIdToUse: string | null) => {
    if (!token || !gapiInited || !spreadsheetIdToUse) return;
    console.log("Attempting to set up sheet headers for sheet ID:", spreadsheetIdToUse);
    setStatusMessage(FIELD_LABELS_TH.SETTING_UP_SHEET_HEADERS);
    try {
        const spreadsheet = await window.gapi.client.sheets.spreadsheets.get({
            spreadsheetId: spreadsheetIdToUse,
            fields: 'sheets.properties.title',
        });
        const sheetExists = spreadsheet.result.sheets?.some(s => s.properties?.title === SHEET_NAME);

        if (!sheetExists) {
            await window.gapi.client.sheets.spreadsheets.batchUpdate({
                spreadsheetId: spreadsheetIdToUse,
                resource: {
                    requests: [{ addSheet: { properties: { title: SHEET_NAME } } }],
                },
            });
            console.log(`Sheet tab "${SHEET_NAME}" created.`);
        }
        
        await window.gapi.client.sheets.spreadsheets.values.update({
            spreadsheetId: spreadsheetIdToUse,
            range: `${SHEET_NAME}!A1`,
            valueInputOption: 'USER_ENTERED',
            resource: {
                values: [SHEET_FIELD_ORDER],
            },
        });
        console.log("Sheet headers set up successfully in " + SHEET_NAME);
        setStatusMessage(FIELD_LABELS_TH.HEADERS_CONFIGURED_SUCCESS);
    } catch (error: any) {
        console.error('Error setting up sheet headers:', error);
        setStatusMessage(`${FIELD_LABELS_TH.ERROR_SETTING_UP_HEADERS}: ${error.result?.error?.message || 'Unknown error'}`);
    }
  }, [gapiInited]);


  const loadMeasurementsFromSheet = useCallback(async (token: string | null, spreadsheetIdToUse: string | null) => {
    if (!token || !gapiInited || !spreadsheetIdToUse) {
      setIsLoading(false);
      if (!token && !gapiInited && !userSpreadsheetId) updateUiBasedOnAuthState(null); // Ensure fallback if called inappropriately
      return;
    }
    setIsLoading(true);
    setStatusMessage(FIELD_LABELS_TH.SYNCING_DATA);
    try {
      const response = await window.gapi.client.sheets.spreadsheets.values.get({
        spreadsheetId: spreadsheetIdToUse,
        range: `${SHEET_NAME}!A:AZ`,
      });
      const values = response.result.values;
      if (values && values.length > 1) {
        const headerRow = values[0];
        if(JSON.stringify(headerRow) !== JSON.stringify(SHEET_FIELD_ORDER)) {
            console.warn("Sheet header mismatch. Expected:", SHEET_FIELD_ORDER, "Got:", headerRow);
            setStatusMessage(FIELD_LABELS_TH.ERROR_SHEET_HEADER_MISMATCH_ATTEMPT_FIX);
            await setupSheetHeaders(token, spreadsheetIdToUse);
            await loadMeasurementsFromSheet(token, spreadsheetIdToUse);
            return;
        }
        const loadedMeasurements = values.slice(1)
          .map((row, index) => rowToMeasurement(row, index + 2))
          .filter(m => m.id);
        setMeasurements(loadedMeasurements);
        setStatusMessage(FIELD_LABELS_TH.SYNCED_WITH_GOOGLE_SHEETS);
      } else if (values && values.length <=1 ){
        setMeasurements([]);
        setStatusMessage(FIELD_LABELS_TH.NO_RECORDS + ` (${FIELD_LABELS_TH.GOOGLE_SHEETS_STORAGE})`);
        if (!values || values.length === 0 || (values.length === 1 && JSON.stringify(values[0]) !== JSON.stringify(SHEET_FIELD_ORDER))) {
            await setupSheetHeaders(token, spreadsheetIdToUse);
        }
      } else {
        setMeasurements([]);
        setStatusMessage(FIELD_LABELS_TH.NO_RECORDS + ` (${FIELD_LABELS_TH.GOOGLE_SHEETS_STORAGE}) - ${FIELD_LABELS_TH.ERROR_EMPTY_RESPONSE}`);
         await setupSheetHeaders(token, spreadsheetIdToUse);
      }
    } catch (error: any) {
      console.error('Error loading measurements from Google Sheets:', error);
      const errorMessage = error.result?.error?.message || error.message || 'Unknown error';
      if (error.result?.error?.status === 'NOT_FOUND' || errorMessage.toLowerCase().includes('requested entity was not found')) {
        setStatusMessage(`${FIELD_LABELS_TH.ERROR_SYNCING_DATA}: Sheet tab "${SHEET_NAME}" not found. Attempting to create headers.`);
        await setupSheetHeaders(token, spreadsheetIdToUse); // This should create the tab with headers
      } else if (error.result?.error?.code === 403 && error.result?.error?.status === "PERMISSION_DENIED"){
         setStatusMessage(`${FIELD_LABELS_TH.ERROR_PERMISSION_DENIED_SHEETS}`);
         handleAuthClick();
      }
      else {
        setStatusMessage(`${FIELD_LABELS_TH.ERROR_SYNCING_DATA}: ${errorMessage}`);
        updateUiBasedOnAuthState(null);
      }
    }
    setIsLoading(false);
  }, [gapiInited, updateUiBasedOnAuthState, setupSheetHeaders, userSpreadsheetId]);


  const handleSave = async (measurementToSave: CustomerMeasurement) => {
    let finalMeasurement = { ...measurementToSave };
    if (!finalMeasurement.measurementDate) finalMeasurement.measurementDate = new Date().toISOString().split('T')[0];
    if (!finalMeasurement.id) finalMeasurement.id = Date.now().toString();

    if (!accessToken || !gapiInited || !userSpreadsheetId) {
      setStatusMessage(FIELD_LABELS_TH.SAVING_TO_LOCAL_STORAGE_SIGN_IN_PROMPT);
      if (!isSignedIn) { // If not signed in at all, prompt
          handleAuthClick(() => handleSave(measurementToSave));
          return;
      }
      // If signed in (isSignedIn is true) but other conditions like !gapiInited or !userSpreadsheetId fail,
      // this implies an issue with sheet setup or GAPI init, so save locally as a fallback.
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
        await window.gapi.client.sheets.spreadsheets.values.update({
          spreadsheetId: userSpreadsheetId,
          range: `${SHEET_NAME}!A${finalMeasurement.rowIndex}`,
          valueInputOption: 'USER_ENTERED',
          resource: { values: [rowData] },
        });
      } else {
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
          if (match && match[1]) finalMeasurement.rowIndex = parseInt(match[1], 10);
        }
      }
      setStatusMessage(FIELD_LABELS_TH.SYNCED_WITH_GOOGLE_SHEETS);
      await loadMeasurementsFromSheet(accessToken, userSpreadsheetId);
    } catch (error: any) {
      console.error('Error saving measurement to Google Sheets:', error);
      setStatusMessage(`${FIELD_LABELS_TH.ERROR_SYNCING_DATA}: ${error.result?.error?.message || error.message}`);
      // Consider local save as fallback here too, or retry mechanism. For now, shows error.
    }
    setCurrentView(ViewMode.List);
    setEditingMeasurement(null);
    setIsLoading(false);
  };

  // Helper to get numeric sheetId by its title
  const getSheetIdByTitle = async (spreadsheetFileId: string, sheetTitle: string): Promise<number | undefined> => {
    try {
        const response = await window.gapi.client.sheets.spreadsheets.get({
            spreadsheetId: spreadsheetFileId,
            fields: 'sheets(properties(sheetId,title))',
        });
        const sheet = response.result.sheets?.find(s => s.properties?.title === sheetTitle);
        return sheet?.properties?.sheetId;
    } catch (error) {
        console.error(`Error getting sheetId for title ${sheetTitle}:`, error);
        return undefined; 
    }
  };

  const handleDelete = useCallback(async (id: string) => {
    const measurementToDelete = measurements.find(m => m.id === id);
    if (!measurementToDelete) return;
    if (!window.confirm(FIELD_LABELS_TH.CONFIRM_DELETE_MESSAGE)) return;

    if (!accessToken || !gapiInited || !userSpreadsheetId || !measurementToDelete.rowIndex) {
      setStatusMessage(FIELD_LABELS_TH.DELETING_FROM_LOCAL_STORAGE_SIGN_IN_PROMPT);
      if(!isSignedIn){
        handleAuthClick(() => handleDelete(id));
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
        throw new Error(`Could not find sheet ID for "${SHEET_NAME}" to delete row.`);
      }
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
      setStatusMessage(FIELD_LABELS_TH.SYNCED_WITH_GOOGLE_SHEETS);
      await loadMeasurementsFromSheet(accessToken, userSpreadsheetId);
    } catch (error: any) {
      console.error('Error deleting measurement from Google Sheets:', error);
      setStatusMessage(`${FIELD_LABELS_TH.ERROR_SYNCING_DATA}: ${error.result?.error?.message || error.message || String(error)}`);
    }
    setIsLoading(false);
  }, [measurements, accessToken, gapiInited, userSpreadsheetId, loadMeasurementsFromSheet, isSignedIn]);


  const handleAddNew = () => {
    setEditingMeasurement({ ...initialMeasurementState, id: '' });
    setCurrentView(ViewMode.Form);
  };

  const handleEdit = (measurement: CustomerMeasurement) => {
    setEditingMeasurement({ ...initialMeasurementState, ...measurement });
    setCurrentView(ViewMode.Form);
  };

  const handleCancelForm = () => {
    setCurrentView(ViewMode.List);
    setEditingMeasurement(null);
  };

  const sortedMeasurements = [...measurements].sort((a,b) => {
    const dateA = new Date(a.measurementDate || 0).getTime();
    const dateB = new Date(b.measurementDate || 0).getTime();
    if (dateB !== dateA) return dateB - dateA;
    if(a.rowIndex && b.rowIndex) return (a.rowIndex < b.rowIndex) ? -1 : 1; // Maintain sheet order for same date
    if (a.id && b.id) return (a.id < b.id) ? -1 : 1; // Fallback sort by ID
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
          {(!gapiInited || !gisInited && !isSignedIn) && <p className="text-lg text-sky-700">{FIELD_LABELS_TH.LOADING_APP_DATA} (Google API)...</p>}

          {gapiInited && gisInited && !isSignedIn && (
            <button
              onClick={() => handleAuthClick()}
              className="px-6 py-3 text-lg font-semibold rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition duration-150 shadow-md"
              disabled={isLoading || !tokenClient}
            >
              {FIELD_LABELS_TH.SIGN_IN_WITH_GOOGLE}
            </button>
          )}
          {/* Render sign-out button if isSignedIn is true, regardless of gapi/gis init status after initial sign-in */}
          {isSignedIn && (
            <button
              onClick={handleSignoutClick}
              className="px-6 py-3 text-lg font-semibold rounded-lg bg-slate-500 text-white hover:bg-slate-600 transition duration-150 shadow-md"
              disabled={isLoading && statusMessage !== FIELD_LABELS_TH.USING_LOCAL_STORAGE } // Disable if genuinely loading, not just on local
            >
              {FIELD_LABELS_TH.SIGN_OUT_GOOGLE}
            </button>
          )}
          {statusMessage && <p className={`mt-3 text-md ${statusMessage.includes('Error') || statusMessage.includes('ข้อผิดพลาด') || statusMessage.includes('mismatch') ? 'text-red-600' : 'text-slate-700'}`}>{statusMessage}</p>}
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
