
export interface CustomerMeasurement {
  id: string;
  // Personal Info
  name: string;
  nickname: string; // Added nickname
  address: string;
  phone: string;
  measurementDate: string; // Combined date field, stores as YYYY-MM-DD
  unit: 'cm' | 'inch'; // New field for unit selection

  // Body Measurements (in cm) - stored as strings for form handling
  frontLength: string;
  backLength: string;
  sideLength: string;
  shoulder: string;
  frontShoulderWidth: string;
  backShoulderWidth: string;
  neckCircumference: string;
  armhole: string;
  chestCircumference: string;
  bustDistance: string;
  bustHeight: string;
  waistCircumference: string;
  upperHipCircumference: string;
  hipCircumference: string;
  skirtLength: string;
  sleeveLength: string;
  sleeveWidthAtElbow: string;
  shirtLengthToWrist: string;
  overallLength: string;

  sittingWaist: string;
  waistToKnee: string;
  kneeCircumference: string;
  thighCircumference: string;
  calfCircumference: string;
  waistToAnkleLength: string;
  ankleCircumference: string;
  crotchDepth: string;

  notes: string;
  fabricSampleDescription: string;

  rowIndex?: number; // Optional: For tracking row number in Google Sheets
}

export const initialMeasurementState: CustomerMeasurement = {
  id: '',
  name: '',
  nickname: '', 
  address: '',
  phone: '',
  measurementDate: '', 
  unit: 'inch', 
  frontLength: '',
  backLength: '',
  sideLength: '',
  shoulder: '',
  frontShoulderWidth: '',
  backShoulderWidth: '',
  neckCircumference: '',
  armhole: '',
  chestCircumference: '',
  bustDistance: '',
  bustHeight: '',
  waistCircumference: '',
  upperHipCircumference: '',
  hipCircumference: '',
  skirtLength: '',
  sleeveLength: '',
  sleeveWidthAtElbow: '',
  shirtLengthToWrist: '',
  overallLength: '',
  sittingWaist: '',
  waistToKnee: '',
  kneeCircumference: '',
  thighCircumference: '',
  calfCircumference: '',
  waistToAnkleLength: '',
  ankleCircumference: '',
  crotchDepth: '',
  notes: '',
  fabricSampleDescription: '',
  // rowIndex is not part of initial state for a new, unsaved item
};

export enum ViewMode {
  List,
  Form
}

// Define the order of fields for Google Sheets headers and row data.
// It's crucial that this order matches the CustomerMeasurement interface and the sheet's header row.
export const SHEET_FIELD_ORDER: (keyof CustomerMeasurement)[] = [
  'id', 'name', 'nickname', 'address', 'phone', 'measurementDate', 'unit',
  'frontLength', 'backLength', 'sideLength', 'shoulder', 'frontShoulderWidth', 'backShoulderWidth',
  'neckCircumference', 'armhole', 'chestCircumference', 'bustDistance', 'bustHeight',
  'waistCircumference', 'upperHipCircumference', 'hipCircumference', 'skirtLength',
  'sleeveLength', 'sleeveWidthAtElbow', 'shirtLengthToWrist', 'overallLength',
  'sittingWaist', 'waistToKnee', 'kneeCircumference', 'thighCircumference', 'calfCircumference',
  'waistToAnkleLength', 'ankleCircumference', 'crotchDepth',
  'notes', 'fabricSampleDescription'
  // rowIndex is not stored in the sheet itself, it's metadata for API operations
];
