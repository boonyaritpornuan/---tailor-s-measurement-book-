
import React, { useState, useEffect, useCallback } from 'react';
import type { CustomerMeasurement } from './types';
import { ViewMode, initialMeasurementState, SHEET_FIELD_ORDER } from './types';
import { FIELD_LABELS_TH, USER_SPREADSHEET_FILENAME, LS_ACCESS_TOKEN, LS_TOKEN_EXPIRY, LS_IS_SIGNED_IN } from './constants';
import MeasurementList from './components/MeasurementList';
import MeasurementForm from './components/MeasurementForm';

const GOOGLE_CLIENT_ID_FOR_SHEETS = '436169620275-06sdal64e81ms1ohb5l3q4fbvni7j12s.apps.googleusercontent.com';
const SHEET_NAME = 'CustomerData';
const SCOPES = 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file';
const LOCAL_STORAGE_KEY = 'tailorMeasurementsApp_localStorageFallback';

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: Array<string>;
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed',
    platform: string
  }>;
  prompt(): Promise<void>;
}

const rowToMeasurement = (row: any[], rowIndex: number): CustomerMeasurement => {
  const measurement: Partial<CustomerMeasurement> = {};
  SHEET_FIELD_ORDER.forEach((key, index) => {
    if (row[index] !== undefined && key !== 'rowIndex') {
      (measurement as any)[key] = row[index];
    }
  });
  const fullMeasurement = { ...initialMeasurementState, ...measurement, id: measurement.id || '' };
  fullMeasurement.rowIndex = rowIndex;
  return fullMeasurement as CustomerMeasurement;
};

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

  const [deferredInstallPrompt, setDeferredInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showInstallBanner, setShowInstallBanner] = useState(false);
  const [appInstallStatusMessage, setAppInstallStatusMessage] = useState<string | null>(null);


  useEffect(() => {
    const handleBeforeInstallPrompt = (event: Event) => {
      console.log('[App.tsx] beforeinstallprompt event fired');
      event.preventDefault();
      setDeferredInstallPrompt(event as BeforeInstallPromptEvent);
      setShowInstallBanner(true);
      setStatusMessage(FIELD_LABELS_TH.APP_INSTALL_AVAILABLE); // Notify user it's installable
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    const handleAppInstalled = () => {
      console.log('[App.tsx] appinstalled event fired');
      setDeferredInstallPrompt(null);
      setShowInstallBanner(false);
      setAppInstallStatusMessage(FIELD_LABELS_TH.APP_INSTALL_SUCCESS);
      setTimeout(() => setAppInstallStatusMessage(null), 5000); // Clear message after 5s
    };

    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const handleInstallAppClick = async () => {
    if (!deferredInstallPrompt) {
      console.warn('[App.tsx] handleInstallAppClick: No deferredInstallPrompt available.');
      return;
    }
    deferredInstallPrompt.prompt();
    const { outcome } = await deferredInstallPrompt.userChoice;
    console.log(`[App.tsx] User choice for app install: ${outcome}`);
    if (outcome === 'accepted') {
      setAppInstallStatusMessage(FIELD_LABELS_TH.APP_INSTALL_SUCCESS);
      setTimeout(() => setAppInstallStatusMessage(null), 5000);
    } else {
      // User dismissed the prompt, maybe log or handle this.
      // The banner is hidden regardless.
    }
    setDeferredInstallPrompt(null);
    setShowInstallBanner(false);
  };

  const handleDismissInstallBannerClick = () => {
    setShowInstallBanner(false);
    // Optionally, store a flag in localStorage to not show again for some time
  };

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
      if(!isSignedIn) setStatusMessage(FIELD_LABELS_TH.USING_LOCAL_STORAGE);
    } catch (error) {
      console.error("[App.tsx] loadMeasurementsFromLocalStorage: Failed to load:", error);
      setMeasurements([]);
      if(!isSignedIn) setStatusMessage(FIELD_LABELS_TH.ERROR_LOADING_LOCAL_DATA);
    }
    setIsLoading(false);
  }, [isSignedIn]);

  const handleSignoutLogic = useCallback((isAutoSignoutDueToError: boolean = false) => {
    console.log(`[App.tsx] handleSignoutLogic: Initiating sign-out. Auto sign-out: ${isAutoSignoutDueToError}`);
    localStorage.removeItem(LS_ACCESS_TOKEN);
    localStorage.removeItem(LS_TOKEN_EXPIRY);
    localStorage.removeItem(LS_IS_SIGNED_IN);

    setAccessToken(null);
    setIsSignedIn(false);
    setUserSpreadsheetId(null);
    setActionRequiresAuth(null);
    if (window.gapi?.client) window.gapi.client.setToken(null);

    if (isAutoSignoutDueToError) {
      setStatusMessage(FIELD_LABELS_TH.SESSION_EXPIRED_SIGN_IN);
    } else {
      setStatusMessage(FIELD_LABELS_TH.SIGNED_OUT_USING_LOCAL);
    }
    loadMeasurementsFromLocalStorage(); 
  }, [loadMeasurementsFromLocalStorage]);

  const handleSignoutClick = useCallback((isAutoSignoutDueToError: boolean = false) => {
    const currentTokenToRevoke = accessToken;
    if (currentTokenToRevoke && window.google?.accounts?.oauth2?.revoke) {
      console.log('[App.tsx] handleSignoutClick: Revoking token.');
      window.google.accounts.oauth2.revoke(currentTokenToRevoke, () => {
        console.log('[App.tsx] handleSignoutClick: Token revoked callback.');
        handleSignoutLogic(isAutoSignoutDueToError);
      });
    } else {
       console.warn('[App.tsx] handleSignoutClick: No token to revoke or GIS revoke not available. Proceeding with local sign out.');
       handleSignoutLogic(isAutoSignoutDueToError);
    }
  }, [accessToken, handleSignoutLogic]);
  
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
      const driveResponse = await window.gapi.client.drive.files.list({
        q: `name='${USER_SPREADSHEET_FILENAME}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`,
        fields: 'files(id, name)', spaces: 'drive',
      });
      if (driveResponse.result.files && driveResponse.result.files.length > 0) {
        const foundFileId = driveResponse.result.files[0].id;
        setUserSpreadsheetId(foundFileId);
        await loadMeasurementsFromSheet(token, foundFileId);
      } else {
        setStatusMessage(FIELD_LABELS_TH.SPREADSHEET_NOT_FOUND_CREATING);
        const createResponse = await window.gapi.client.drive.files.create({
          resource: { name: USER_SPREADSHEET_FILENAME, mimeType: 'application/vnd.google-apps.spreadsheet' },
          fields: 'id',
        });
        const newFileId = createResponse.result.id;
        setUserSpreadsheetId(newFileId);
        setStatusMessage(FIELD_LABELS_TH.SPREADSHEET_CREATED_SETUP_HEADERS);
        await setupSheetHeaders(token, newFileId);
        await loadMeasurementsFromSheet(token, newFileId); 
      }
    } catch (error: any) {
      console.error('[App.tsx] findOrCreateUserSpreadsheet: Error:', JSON.stringify(error, null, 2));
      const statusCode = error.result?.error?.code;
      const statusText = error.result?.error?.status;
      if (statusCode === 401 || statusCode === 403 || statusText === 'UNAUTHENTICATED') {
        handleSignoutClick(true);
      } else {
        setStatusMessage(`${FIELD_LABELS_TH.ERROR_DRIVE_OPERATION}: ${error.result?.error?.message || error.message}`);
        setIsSignedIn(false); setAccessToken(null); 
      }
    }
  }, [gapiInited, handleSignoutClick]);


  const onTokenResponse = useCallback(async (tokenResponse: any) => {
    console.log('[App.tsx] onTokenResponse: Received tokenResponse:', tokenResponse);
    if (tokenResponse && tokenResponse.access_token) {
      console.log('[App.tsx] onTokenResponse: Access token received.');
      const newAccessToken = tokenResponse.access_token;
      const expiresIn = tokenResponse.expires_in || 3600; 
      const expiryTime = Date.now() + expiresIn * 1000;

      setAccessToken(newAccessToken);
      setIsSignedIn(true);
      
      localStorage.setItem(LS_ACCESS_TOKEN, newAccessToken);
      localStorage.setItem(LS_TOKEN_EXPIRY, expiryTime.toString());
      localStorage.setItem(LS_IS_SIGNED_IN, 'true');

      if (actionRequiresAuth) {
        console.log('[App.tsx] onTokenResponse: Executing pending actionRequiresAuth.');
        actionRequiresAuth();
        setActionRequiresAuth(null);
      }
    } else {
      console.error('[App.tsx] onTokenResponse: Token response error or access_token missing.', tokenResponse);
      setStatusMessage(FIELD_LABELS_TH.ERROR_AUTHENTICATING);
      handleSignoutLogic(true); 
    }
  }, [actionRequiresAuth, handleSignoutLogic]);

  const initializeGapiClient = useCallback(async () => {
    console.log('[App.tsx] initializeGapiClient: Starting GAPI client initialization.');
    if (!window.gapi?.client?.init) {
        console.error('[App.tsx] initializeGapiClient: window.gapi.client.init is not available.');
        setStatusMessage(FIELD_LABELS_TH.ERROR_GAPI_CLIENT_INIT_NOT_FOUND);
        setGapiInited(false); setIsLoading(false);
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
      setGapiInited(false); setIsLoading(false); 
    }
  }, []);


  useEffect(() => {
    console.log('[App.tsx] useEffect[]: Initializing app state and Google API scripts.');
    setIsLoading(true);
    setStatusMessage(FIELD_LABELS_TH.LOADING_APP_DATA);

    let sessionRestoredFromLocalStorage = false;
    const storedToken = localStorage.getItem(LS_ACCESS_TOKEN);
    const storedExpiry = localStorage.getItem(LS_TOKEN_EXPIRY);
    const storedIsSignedIn = localStorage.getItem(LS_IS_SIGNED_IN);

    if (storedToken && storedExpiry && storedIsSignedIn === 'true') {
      const expiryTime = parseInt(storedExpiry, 10);
      if (Date.now() < expiryTime) {
        console.log('[App.tsx] useEffect[]: Valid token found in localStorage. Restoring session.');
        setAccessToken(storedToken);
        setIsSignedIn(true);
        setStatusMessage(FIELD_LABELS_TH.SESSION_RESTORED_LOADING_DATA);
        sessionRestoredFromLocalStorage = true;
      } else {
        console.log('[App.tsx] useEffect[]: Token found in localStorage but expired. Clearing.');
        localStorage.removeItem(LS_ACCESS_TOKEN);
        localStorage.removeItem(LS_TOKEN_EXPIRY);
        localStorage.removeItem(LS_IS_SIGNED_IN);
      }
    }
    
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
            setGapiInited(false); setIsLoading(false); 
        }
    };
    gapiScript.onerror = () => {
        console.error('[App.tsx] GAPI script FAILED to load.');
        setStatusMessage(FIELD_LABELS_TH.ERROR_GAPI_LOAD_FUNCTION_NOT_FOUND);
        setGapiInited(false); setIsLoading(false);
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
        if (!sessionRestoredFromLocalStorage && gapiInited) {
             setIsLoading(false);
        } else if (!sessionRestoredFromLocalStorage && !gapiInited) {
            // Still waiting for GAPI
        }
      } else {
        console.error('[App.tsx] GIS script loaded, but window.google.accounts.oauth2 not found.');
        setStatusMessage(FIELD_LABELS_TH.ERROR_GIS_NOT_READY);
        setGisInited(false); setIsLoading(false);
      }
    };
    gisScript.onerror = () => {
        console.error('[App.tsx] GIS script FAILED to load.');
        setStatusMessage(FIELD_LABELS_TH.ERROR_GIS_NOT_READY);
        setGisInited(false); setIsLoading(false);
    };
    document.body.appendChild(gisScript);

    return () => {
      console.log('[App.tsx] useEffect[] cleanup: Removing API scripts.');
      if (gapiScript.parentNode) gapiScript.parentNode.removeChild(gapiScript);
      if (gisScript.parentNode) gisScript.parentNode.removeChild(gisScript);
    };
  }, [onTokenResponse, initializeGapiClient]); 


  useEffect(() => {
    console.log(`[App.tsx] useEffect[isSignedIn,accessToken,gapiInited,gisInited]: States - isSignedIn: ${isSignedIn}, accessToken: ${accessToken ? 'Exists' : 'Null'}, gapiInited: ${gapiInited}, gisInited: ${gisInited}`);
    if (isSignedIn && accessToken && gapiInited) {
      console.log('[App.tsx] useEffect[isSigned...]: All conditions met. Setting GAPI token and loading Google Drive data.');
      setIsLoading(true); 
      setStatusMessage(FIELD_LABELS_TH.AUTHENTICATED_INITIALIZING_APIS); 
      if (window.gapi?.client) {
        window.gapi.client.setToken({ access_token: accessToken });
        findOrCreateUserSpreadsheet(accessToken);
      } else {
         console.error('[App.tsx] useEffect[isSigned...]: isSignedIn, accessToken, gapiInited all true, but window.gapi.client not available!');
         setStatusMessage(FIELD_LABELS_TH.ERROR_GAPI_CLIENT_UNEXPECTED);
         setIsLoading(false);
      }
    } else if (!isSignedIn && gapiInited && gisInited) { 
      console.log('[App.tsx] useEffect[isSigned...]: Not signed in, but scripts ready. Using local storage.');
      if (window.gapi?.client) window.gapi.client.setToken(null);
      setUserSpreadsheetId(null);
      loadMeasurementsFromLocalStorage(); 
      setStatusMessage(FIELD_LABELS_TH.USING_LOCAL_STORAGE);
    } else if (isSignedIn && accessToken && !gapiInited) {
      console.log('[App.tsx] useEffect[isSigned...]: Signed in, token present, but GAPI not yet ready. Waiting...');
      setStatusMessage(FIELD_LABELS_TH.AUTHENTICATED_INITIALIZING_APIS);
      setIsLoading(true);
    } else if (!gapiInited || !gisInited) {
        console.log('[App.tsx] useEffect[isSigned...]: Scripts (GAPI or GIS or both) not yet loaded/initialized. Waiting...');
        setIsLoading(true); 
        if(!accessToken) setStatusMessage(FIELD_LABELS_TH.LOADING_APP_DATA + " (Google API)...");
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
    console.log(`[App.tsx] handleAuthClick: Requesting access token.`);
    tokenClient.requestAccessToken({ prompt: '' }); 
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
    if (!token || !gapiInited || !spreadsheetIdToUse) return; 
    try {
        const spreadsheet = await window.gapi.client.sheets.spreadsheets.get({
            spreadsheetId: spreadsheetIdToUse, fields: 'sheets.properties.title',
        });
        const sheetExists = spreadsheet.result.sheets?.some(s => s.properties?.title === SHEET_NAME);
        if (!sheetExists) {
            await window.gapi.client.sheets.spreadsheets.batchUpdate({
                spreadsheetId: spreadsheetIdToUse, resource: { requests: [{ addSheet: { properties: { title: SHEET_NAME } } }] },
            });
        }
        await window.gapi.client.sheets.spreadsheets.values.update({
            spreadsheetId: spreadsheetIdToUse, range: `${SHEET_NAME}!A1`, valueInputOption: 'USER_ENTERED',
            resource: { values: [SHEET_FIELD_ORDER] },
        });
    } catch (error: any) {
        console.error('[App.tsx] setupSheetHeaders: Error setting up sheet headers:', JSON.stringify(error, null, 2));
        const statusCode = error.result?.error?.code;
        const statusText = error.result?.error?.status;
        if (statusCode === 401 || statusCode === 403 || statusText === 'UNAUTHENTICATED') {
            handleSignoutClick(true);
        } else {
            setStatusMessage(`${FIELD_LABELS_TH.ERROR_SETTING_UP_HEADERS}: ${error.result?.error?.message || 'Unknown error'}`);
        }
    }
  }, [gapiInited, handleSignoutClick]);


  const loadMeasurementsFromSheet = useCallback(async (token: string | null, spreadsheetIdToUse: string | null) => {
    if (!token || !gapiInited || !spreadsheetIdToUse) {
      setIsLoading(false); return;
    }
    setIsLoading(true); setStatusMessage(FIELD_LABELS_TH.SYNCING_DATA);
    try {
      const response = await window.gapi.client.sheets.spreadsheets.values.get({
        spreadsheetId: spreadsheetIdToUse, range: `${SHEET_NAME}!A:AZ`, 
      });
      const values = response.result.values;
      if (values && values.length > 0) { 
        const headerRow = values[0];
        if(JSON.stringify(headerRow) !== JSON.stringify(SHEET_FIELD_ORDER)) {
            setStatusMessage(FIELD_LABELS_TH.ERROR_SHEET_HEADER_MISMATCH_ATTEMPT_FIX);
            await setupSheetHeaders(token, spreadsheetIdToUse);
            await loadMeasurementsFromSheet(token, spreadsheetIdToUse); return; 
        }
        const loadedMeasurements = values.slice(1).map((row, index) => rowToMeasurement(row, index + 2)).filter(m => m.id); 
        setMeasurements(loadedMeasurements);
        setStatusMessage(loadedMeasurements.length > 0 ? FIELD_LABELS_TH.SYNCED_WITH_GOOGLE_SHEETS : FIELD_LABELS_TH.NO_RECORDS + ` (${FIELD_LABELS_TH.GOOGLE_SHEETS_STORAGE})`);
      } else { 
        setMeasurements([]); await setupSheetHeaders(token, spreadsheetIdToUse); 
        setStatusMessage(FIELD_LABELS_TH.NO_RECORDS + ` (${FIELD_LABELS_TH.GOOGLE_SHEETS_STORAGE})`); 
      }
    } catch (error: any) {
      console.error('[App.tsx] loadMeasurementsFromSheet: Error:', JSON.stringify(error, null, 2));
      const statusCode = error.result?.error?.code;
      const statusText = error.result?.error?.status;
      const errorMessage = error.result?.error?.message || error.message || 'Unknown error';

      if (statusCode === 401 || statusCode === 403 || statusText === 'UNAUTHENTICATED' || statusText === "PERMISSION_DENIED") {
        handleSignoutClick(true);
      } else if (error.result?.error?.status === 'NOT_FOUND' || errorMessage.toLowerCase().includes('requested entity was not found') || (statusCode === 400 && errorMessage.toLowerCase().includes('unable to parse range'))) {
        setStatusMessage(`${FIELD_LABELS_TH.ERROR_SYNCING_DATA}: Sheet "${SHEET_NAME}" not found. Creating.`);
        await setupSheetHeaders(token, spreadsheetIdToUse); 
        await loadMeasurementsFromSheet(token, spreadsheetIdToUse); return;
      } else {
        setStatusMessage(`${FIELD_LABELS_TH.ERROR_SYNCING_DATA}: ${errorMessage}`);
      }
    }
    setIsLoading(false);
  }, [gapiInited, setupSheetHeaders, handleSignoutClick]); 


  const handleSave = async (measurementToSave: CustomerMeasurement) => {
    setIsLoading(true);
    let finalMeasurement = { ...measurementToSave };
    if (!finalMeasurement.measurementDate) finalMeasurement.measurementDate = new Date().toISOString().split('T')[0];
    if (!finalMeasurement.id) finalMeasurement.id = Date.now().toString();

    if (!isSignedIn || !accessToken || !gapiInited || !userSpreadsheetId) {
      if (!isSignedIn && tokenClient) {
          setActionRequiresAuth(() => () => handleSave(finalMeasurement));
          handleAuthClick(); return;
      }
      console.log('[App.tsx] handleSave: Proceeding with local storage save.');
      setMeasurements(prev => {
        const existingIndex = prev.findIndex(m => m.id === finalMeasurement.id);
        let updatedMeasurements;
        if (existingIndex > -1) updatedMeasurements = prev.map(m => m.id === finalMeasurement.id ? finalMeasurement : m);
        else updatedMeasurements = [finalMeasurement, ...prev];
        updatedMeasurements.sort((a,b) => (new Date(b.measurementDate || 0).getTime() - new Date(a.measurementDate || 0).getTime()));
        saveMeasurementsToLocalStorage(updatedMeasurements);
        return updatedMeasurements;
      });
      setCurrentView(ViewMode.List); setEditingMeasurement(null);
      setStatusMessage(FIELD_LABELS_TH.USING_LOCAL_STORAGE + ' (บันทึกสำเร็จในเครื่อง)');
      setIsLoading(false); return;
    }

    setStatusMessage(FIELD_LABELS_TH.SYNCING_DATA + ' (กำลังบันทึก...)');
    try {
      const rowData = measurementToRow(finalMeasurement);
      if (finalMeasurement.rowIndex && finalMeasurement.id) { 
        const range = `${SHEET_NAME}!A${finalMeasurement.rowIndex}`;
        await window.gapi.client.sheets.spreadsheets.values.update({
          spreadsheetId: userSpreadsheetId, range: range, valueInputOption: 'USER_ENTERED', resource: { values: [rowData] },
        });
      } else { 
        const appendResponse = await window.gapi.client.sheets.spreadsheets.values.append({
          spreadsheetId: userSpreadsheetId, range: `${SHEET_NAME}!A1`, valueInputOption: 'USER_ENTERED',
          insertDataOption: 'INSERT_ROWS', resource: { values: [rowData] },
        });
        const updatedRange = appendResponse.result.updates?.updatedRange;
        if (updatedRange) {
          const match = updatedRange.match(/!A(\d+):/);
          if (match && match[1]) finalMeasurement.rowIndex = parseInt(match[1], 10);
        }
      }
      setStatusMessage(FIELD_LABELS_TH.SYNCED_WITH_GOOGLE_SHEETS + ' (บันทึกสำเร็จ)');
      await loadMeasurementsFromSheet(accessToken, userSpreadsheetId); 
    } catch (error: any) {
      console.error('[App.tsx] handleSave (Sheets): Error saving measurement to Google Sheets:', JSON.stringify(error, null, 2));
      const statusCode = error.result?.error?.code;
      const statusText = error.result?.error?.status;
       if (statusCode === 401 || statusCode === 403 || statusText === 'UNAUTHENTICATED') {
        handleSignoutClick(true);
      } else {
        setStatusMessage(`${FIELD_LABELS_TH.ERROR_SYNCING_DATA}: ${error.result?.error?.message || error.message || 'Unknown error during save'}`);
      }
    }
    setCurrentView(ViewMode.List); setEditingMeasurement(null); setIsLoading(false);
  };

  const getSheetIdByTitle = async (spreadsheetFileId: string, sheetTitle: string): Promise<number | undefined> => {
    if(!gapiInited || !window.gapi?.client?.sheets) return undefined; 
    try {
        const response = await window.gapi.client.sheets.spreadsheets.get({
            spreadsheetId: spreadsheetFileId, fields: 'sheets(properties(sheetId,title))',
        });
        const sheet = response.result.sheets?.find(s => s.properties?.title === sheetTitle);
        return sheet?.properties?.sheetId;
    } catch (error) { return undefined; }
  };

  const handleDelete = useCallback(async (id: string) => {
    const measurementToDelete = measurements.find(m => m.id === id);
    if (!measurementToDelete || !window.confirm(FIELD_LABELS_TH.CONFIRM_DELETE_MESSAGE)) return;
    setIsLoading(true); 

    if (!isSignedIn || !accessToken || !gapiInited || !userSpreadsheetId || !measurementToDelete.rowIndex) {
      if(!isSignedIn && tokenClient){ 
        setActionRequiresAuth(() => () => handleDelete(id)); handleAuthClick(); return;
      }
      const updatedLocalMeasurements = measurements.filter(m => m.id !== id);
      saveMeasurementsToLocalStorage(updatedLocalMeasurements); setMeasurements(updatedLocalMeasurements);
      setStatusMessage(updatedLocalMeasurements.length === 0 ? FIELD_LABELS_TH.NO_RECORDS : FIELD_LABELS_TH.USING_LOCAL_STORAGE + ' (ลบสำเร็จในเครื่อง)'); 
      setIsLoading(false); return;
    }

    setStatusMessage(FIELD_LABELS_TH.SYNCING_DATA + ' (กำลังลบ...)');
    try {
      const sheetNumericId = await getSheetIdByTitle(userSpreadsheetId, SHEET_NAME);
      if (sheetNumericId === undefined) throw new Error(`Could not find sheet ID for "${SHEET_NAME}" to delete row.`);
      await window.gapi.client.sheets.spreadsheets.batchUpdate({
        spreadsheetId: userSpreadsheetId, resource: {
          requests: [{ deleteDimension: { range: {
                sheetId: sheetNumericId, dimension: 'ROWS',
                startIndex: measurementToDelete.rowIndex - 1, endIndex: measurementToDelete.rowIndex,
          }}}]},
      });
      setStatusMessage(FIELD_LABELS_TH.SYNCED_WITH_GOOGLE_SHEETS + ' (ลบสำเร็จ)'); 
      await loadMeasurementsFromSheet(accessToken, userSpreadsheetId); 
    } catch (error: any) {
      console.error('[App.tsx] handleDelete: Error deleting measurement from Google Sheets:', JSON.stringify(error, null, 2));
      const statusCode = error.result?.error?.code;
      const statusText = error.result?.error?.status;
       if (statusCode === 401 || statusCode === 403 || statusText === 'UNAUTHENTICATED') {
        handleSignoutClick(true);
      } else {
        setStatusMessage(`${FIELD_LABELS_TH.ERROR_SYNCING_DATA}: ${error.result?.error?.message || error.message || String(error)}`);
      }
    }
    setIsLoading(false);
  }, [measurements, accessToken, gapiInited, userSpreadsheetId, loadMeasurementsFromSheet, isSignedIn, tokenClient, handleSignoutClick]);


  const handleAddNew = () => {
    setEditingMeasurement({ ...initialMeasurementState, id: '' }); setCurrentView(ViewMode.Form);
  };
  const handleEdit = (measurement: CustomerMeasurement) => {
    setEditingMeasurement({ ...initialMeasurementState, ...measurement }); setCurrentView(ViewMode.Form);
  };
  const handleCancelForm = () => {
    setCurrentView(ViewMode.List); setEditingMeasurement(null);
  };

  const sortedMeasurements = [...measurements].sort((a,b) => {
    const dateA = new Date(a.measurementDate || 0).getTime();
    const dateB = new Date(b.measurementDate || 0).getTime();
    if (dateB !== dateA) return dateB - dateA; 
    if(a.rowIndex && b.rowIndex && a.rowIndex !== b.rowIndex) return (a.rowIndex < b.rowIndex) ? -1 : 1; 
    return (a.id < b.id) ? -1 : 1; 
  });

  return (
    <div className="min-h-screen bg-slate-100 text-slate-800 py-8 px-4 md:px-8">
      <header className="text-center mb-6">
        <h1 className="text-4xl md:text-5xl font-bold text-sky-700">{FIELD_LABELS_TH.APP_TITLE}</h1>
      </header>
      <main className="container mx-auto max-w-7xl">
        <div className="mb-6 p-4 bg-sky-50 border border-sky-200 rounded-lg shadow-sm text-center">
          {isLoading && (!gapiInited || !gisInited) && (!isSignedIn || !accessToken) &&
            <p className="text-lg text-sky-700 animate-pulse">{statusMessage || FIELD_LABELS_TH.LOADING_APP_DATA}</p>
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
              onClick={() => handleSignoutClick(false)}
              className="px-6 py-3 text-lg font-semibold rounded-lg bg-slate-500 text-white hover:bg-slate-600 transition duration-150 shadow-md"
              disabled={isLoading && statusMessage !== FIELD_LABELS_TH.USING_LOCAL_STORAGE && statusMessage !== FIELD_LABELS_TH.SIGNED_OUT_USING_LOCAL}
            >
              {FIELD_LABELS_TH.SIGN_OUT_GOOGLE}
            </button>
          )}
          {statusMessage && (!isLoading || (isLoading && (statusMessage.includes('Error') || statusMessage.includes('ข้อผิดพลาด') || statusMessage.includes('หมดอายุ') || statusMessage.includes('กู้คืน') || statusMessage === FIELD_LABELS_TH.USING_LOCAL_STORAGE || statusMessage === FIELD_LABELS_TH.SIGNED_OUT_USING_LOCAL || statusMessage === FIELD_LABELS_TH.APP_INSTALL_AVAILABLE))) &&
            <p className={`mt-3 text-md ${statusMessage.includes('Error') || statusMessage.includes('ข้อผิดพลาด') || statusMessage.includes('หมดอายุ') || statusMessage.includes('mismatch') || statusMessage.includes('Failed') || statusMessage.includes('ไม่พบ') ? 'text-red-600' : 'text-slate-700'}`}>{statusMessage}</p>
          }
           {isLoading && (isSignedIn || statusMessage === FIELD_LABELS_TH.SYNCING_DATA || statusMessage === FIELD_LABELS_TH.AUTHENTICATED_SEARCHING_SHEET || statusMessage === FIELD_LABELS_TH.AUTHENTICATED_INITIALIZING_APIS || statusMessage === FIELD_LABELS_TH.SESSION_RESTORED_LOADING_DATA ) && 
             (!statusMessage.includes('Error') && !statusMessage.includes('หมดอายุ') && !statusMessage.includes('กู้คืน') && statusMessage !== FIELD_LABELS_TH.USING_LOCAL_STORAGE && statusMessage !== FIELD_LABELS_TH.SIGNED_OUT_USING_LOCAL && statusMessage !== FIELD_LABELS_TH.APP_INSTALL_AVAILABLE) &&
             <p className="text-sm text-sky-600 animate-pulse">{FIELD_LABELS_TH.LOADING_DATA}...</p>
           }
           {appInstallStatusMessage && (
             <p className="mt-2 text-lg text-green-600 font-semibold">{appInstallStatusMessage}</p>
           )}
        </div>

        {/* Custom Install Banner */}
        {showInstallBanner && deferredInstallPrompt && (
          <div className="fixed bottom-0 left-0 right-0 bg-sky-600 text-white p-4 shadow-lg z-50 transform transition-transform duration-300 ease-out translate-y-0">
            <div className="container mx-auto flex flex-col sm:flex-row items-center justify-between">
              <div className='text-center sm:text-left mb-3 sm:mb-0'>
                <h4 className="text-xl font-semibold">{FIELD_LABELS_TH.INSTALL_APP_PROMPT_TITLE}</h4>
                <p className="text-sm opacity-90">{FIELD_LABELS_TH.INSTALL_APP_DESCRIPTION}</p>
              </div>
              <div className="flex space-x-3">
                <button
                  onClick={handleInstallAppClick}
                  className="px-6 py-2.5 text-lg font-medium rounded-lg bg-white text-sky-700 hover:bg-sky-100 transition duration-150 shadow"
                  aria-label={FIELD_LABELS_TH.INSTALL_APP_BUTTON}
                >
                  {FIELD_LABELS_TH.INSTALL_APP_BUTTON}
                </button>
                <button
                  onClick={handleDismissInstallBannerClick}
                  className="px-4 py-2.5 text-lg font-medium rounded-lg text-white hover:bg-sky-500 transition duration-150"
                  aria-label={FIELD_LABELS_TH.INSTALL_APP_LATER_BUTTON}
                >
                  {FIELD_LABELS_TH.INSTALL_APP_LATER_BUTTON}
                </button>
              </div>
            </div>
          </div>
        )}


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
        <p className="text-slate-500 text-lg">{FIELD_LABELS_TH.APP_TITLE} &copy; {new Date().getFullYear()}</p>
        <p className="text-slate-400 text-sm mt-1">{FIELD_LABELS_TH.FOOTER_SLOGAN}</p>
      </footer>
    </div>
  );
};

export default App;
