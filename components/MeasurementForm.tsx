
import React, { useState, useEffect } from 'react';
import type { CustomerMeasurement } from '../types';
import { initialMeasurementState } from '../types';
import { FIELD_LABELS_TH } from '../constants';
import InputGroup from './InputGroup';

interface MeasurementFormProps {
  onSave: (measurement: CustomerMeasurement) => void;
  onCancel: () => void;
  existingMeasurement: CustomerMeasurement | null;
}

const MeasurementForm: React.FC<MeasurementFormProps> = ({ onSave, onCancel, existingMeasurement }) => {
  const [formData, setFormData] = useState<CustomerMeasurement>(initialMeasurementState);
  const [showCustomerInfo, setShowCustomerInfo] = useState(true);

  useEffect(() => {
    if (existingMeasurement) {
      setFormData({ ...initialMeasurementState, ...existingMeasurement, id: existingMeasurement.id });
    } else {
      setFormData({...initialMeasurementState, id: '', unit: initialMeasurementState.unit}); 
    }
    setShowCustomerInfo(true); 
  }, [existingMeasurement]);

  const handleInputChange = (name: keyof CustomerMeasurement, value: string) => {
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleUnitChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData(prev => ({ ...prev, unit: e.target.value as 'cm' | 'inch' }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    let finalFormData = { ...formData };

    // Auto-fill measurementDate if empty
    if (!finalFormData.measurementDate) {
      finalFormData.measurementDate = new Date().toISOString().split('T')[0];
    }
    // Ensure ID is present
    const idToSave = finalFormData.id || Date.now().toString();
    onSave({ ...finalFormData, id: idToSave });
  };
  
  const unitSuffix = formData.unit === 'cm' ? FIELD_LABELS_TH.UNIT_CM_SHORT : FIELD_LABELS_TH.UNIT_INCH_SHORT;
  const commonNumericProps = { type: "text", inputMode: "numeric" as "numeric", unitSuffix: unitSuffix };

  return (
    <form onSubmit={handleSubmit} className="p-4 md:p-6 bg-white shadow-xl rounded-xl max-w-4xl mx-auto">
      <h2 className="text-2xl md:text-3xl font-bold text-sky-700 mb-8 text-center">
        {existingMeasurement ? FIELD_LABELS_TH.EDIT_BUTTON : FIELD_LABELS_TH.ADD_NEW_MEASUREMENT}
      </h2>

      <div className="mb-8 p-4 border border-sky-200 rounded-lg bg-sky-50">
        <h3 className="text-xl font-semibold text-sky-600 mb-2">{FIELD_LABELS_TH.INSTRUCTIONS_TITLE}</h3>
        <ul className="list-disc list-inside text-slate-700 space-y-1 text-lg">
          <li>{FIELD_LABELS_TH.INSTRUCTION_1}</li>
          <li>{FIELD_LABELS_TH.INSTRUCTION_2}</li>
          <li>{FIELD_LABELS_TH.INSTRUCTION_3}</li>
        </ul>
      </div>

      <button
        type="button"
        onClick={() => setShowCustomerInfo(!showCustomerInfo)}
        className="mb-4 px-6 py-3 text-lg font-semibold rounded-lg border border-sky-500 text-sky-600 hover:bg-sky-50 transition duration-150 w-full sm:w-auto"
        aria-expanded={showCustomerInfo}
        aria-controls="customer-info-section"
      >
        {FIELD_LABELS_TH.TOGGLE_CUSTOMER_INFO_BUTTON}
      </button>
      
      {showCustomerInfo && (
        <section id="customer-info-section" className="mb-10 p-4 border border-slate-300 rounded-lg bg-slate-50/50">
          <h3 className="text-xl font-semibold text-sky-600 mb-6 pb-2 border-b-2 border-sky-200">{FIELD_LABELS_TH.CUSTOMER_INFO_TITLE}</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
            <InputGroup label={FIELD_LABELS_TH.NAME} name="name" value={formData.name} onChange={handleInputChange} placeholder="เช่น คุณสมศรี ใจดี"/>
            <InputGroup label={FIELD_LABELS_TH.NICKNAME} name="nickname" value={formData.nickname} onChange={handleInputChange} placeholder="เช่น ศรี"/>
            <InputGroup label={FIELD_LABELS_TH.PHONE} name="phone" value={formData.phone} onChange={handleInputChange} type="tel" inputMode="tel" placeholder="เช่น 0812345678"/>
            <InputGroup 
              label={FIELD_LABELS_TH.DATE} 
              name="measurementDate" 
              value={formData.measurementDate} 
              onChange={handleInputChange} 
              type="date"
              placeholder="เลือกวันที่ (ถ้าไม่เลือก จะเป็นวันที่ปัจจุบัน)" 
            />
          </div>
          <InputGroup label={FIELD_LABELS_TH.ADDRESS} name="address" value={formData.address} onChange={handleInputChange} isTextarea placeholder="รายละเอียดที่อยู่ (ถ้ามี)"/>
        </section>
      )}

      {/* Unit Selection */}
      <section className="mb-10 p-4 border border-slate-300 rounded-lg bg-slate-50/50">
        <h3 className="text-xl font-semibold text-sky-600 mb-4">{FIELD_LABELS_TH.UNIT_SELECTION_LABEL}</h3>
        <div className="flex flex-col sm:flex-row space-y-3 sm:space-y-0 sm:space-x-6">
          <label className="flex items-center space-x-2 text-lg cursor-pointer">
            <input 
              type="radio" 
              name="unit" 
              value="inch" 
              checked={formData.unit === 'inch'} 
              onChange={handleUnitChange}
              className="form-radio h-5 w-5 text-sky-600 border-slate-400 focus:ring-sky-500"
            />
            <span>{FIELD_LABELS_TH.UNIT_INCH}</span>
          </label>
          <label className="flex items-center space-x-2 text-lg cursor-pointer">
            <input 
              type="radio" 
              name="unit" 
              value="cm" 
              checked={formData.unit === 'cm'} 
              onChange={handleUnitChange}
              className="form-radio h-5 w-5 text-sky-600 border-slate-400 focus:ring-sky-500"
            />
            <span>{FIELD_LABELS_TH.UNIT_CM}</span>
          </label>
        </div>
      </section>

      {/* Measurements */}
      <section className="mb-10">
        <h3 className="text-xl font-semibold text-sky-600 mb-6 pb-2 border-b-2 border-sky-200">{FIELD_LABELS_TH.MEASUREMENTS_COL1_TITLE}</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-0">
            <InputGroup label={FIELD_LABELS_TH.FRONT_LENGTH} name="frontLength" value={formData.frontLength} onChange={handleInputChange} {...commonNumericProps} />
            <InputGroup label={FIELD_LABELS_TH.BACK_LENGTH} name="backLength" value={formData.backLength} onChange={handleInputChange} {...commonNumericProps} />
            <InputGroup label={FIELD_LABELS_TH.SIDE_LENGTH} name="sideLength" value={formData.sideLength} onChange={handleInputChange} {...commonNumericProps} />
            <InputGroup label={FIELD_LABELS_TH.SHOULDER} name="shoulder" value={formData.shoulder} onChange={handleInputChange} {...commonNumericProps} />
            <InputGroup label={FIELD_LABELS_TH.FRONT_SHOULDER_WIDTH} name="frontShoulderWidth" value={formData.frontShoulderWidth} onChange={handleInputChange} {...commonNumericProps} />
            <InputGroup label={FIELD_LABELS_TH.BACK_SHOULDER_WIDTH} name="backShoulderWidth" value={formData.backShoulderWidth} onChange={handleInputChange} {...commonNumericProps} />
            <InputGroup label={FIELD_LABELS_TH.NECK_CIRCUMFERENCE} name="neckCircumference" value={formData.neckCircumference} onChange={handleInputChange} {...commonNumericProps} />
            <InputGroup label={FIELD_LABELS_TH.ARMHOLE} name="armhole" value={formData.armhole} onChange={handleInputChange} {...commonNumericProps} />
            <InputGroup label={FIELD_LABELS_TH.CHEST_CIRCUMFERENCE} name="chestCircumference" value={formData.chestCircumference} onChange={handleInputChange} {...commonNumericProps} />
            <InputGroup label={FIELD_LABELS_TH.BUST_DISTANCE} name="bustDistance" value={formData.bustDistance} onChange={handleInputChange} {...commonNumericProps} />
            <InputGroup label={FIELD_LABELS_TH.BUST_HEIGHT} name="bustHeight" value={formData.bustHeight} onChange={handleInputChange} {...commonNumericProps} />
            <InputGroup label={FIELD_LABELS_TH.WAIST_CIRCUMFERENCE} name="waistCircumference" value={formData.waistCircumference} onChange={handleInputChange} {...commonNumericProps} />
            <InputGroup label={FIELD_LABELS_TH.UPPER_HIP_CIRCUMFERENCE} name="upperHipCircumference" value={formData.upperHipCircumference} onChange={handleInputChange} {...commonNumericProps} />
            <InputGroup label={FIELD_LABELS_TH.HIP_CIRCUMFERENCE} name="hipCircumference" value={formData.hipCircumference} onChange={handleInputChange} {...commonNumericProps} />
            <InputGroup label={FIELD_LABELS_TH.SKIRT_LENGTH} name="skirtLength" value={formData.skirtLength} onChange={handleInputChange} {...commonNumericProps} />
            <InputGroup label={FIELD_LABELS_TH.SLEEVE_LENGTH} name="sleeveLength" value={formData.sleeveLength} onChange={handleInputChange} {...commonNumericProps} />
            <InputGroup label={FIELD_LABELS_TH.SLEEVE_WIDTH_AT_ELBOW} name="sleeveWidthAtElbow" value={formData.sleeveWidthAtElbow} onChange={handleInputChange} {...commonNumericProps} />
            <InputGroup label={FIELD_LABELS_TH.SHIRT_LENGTH_TO_WRIST} name="shirtLengthToWrist" value={formData.shirtLengthToWrist} onChange={handleInputChange} {...commonNumericProps} />
            <InputGroup label={FIELD_LABELS_TH.OVERALL_LENGTH} name="overallLength" value={formData.overallLength} onChange={handleInputChange} {...commonNumericProps} />
        </div>
      </section>

      <section className="mb-10">
        <h3 className="text-xl font-semibold text-sky-600 mb-6 pb-2 border-b-2 border-sky-200">{FIELD_LABELS_TH.MEASUREMENTS_COL2_TITLE}</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-0">
            <InputGroup label={FIELD_LABELS_TH.SITTING_WAIST} name="sittingWaist" value={formData.sittingWaist} onChange={handleInputChange} {...commonNumericProps} />
            <InputGroup label={FIELD_LABELS_TH.WAIST_TO_KNEE} name="waistToKnee" value={formData.waistToKnee} onChange={handleInputChange} {...commonNumericProps} />
            <InputGroup label={FIELD_LABELS_TH.KNEE_CIRCUMFERENCE} name="kneeCircumference" value={formData.kneeCircumference} onChange={handleInputChange} {...commonNumericProps} />
            <InputGroup label={FIELD_LABELS_TH.THIGH_CIRCUMFERENCE} name="thighCircumference" value={formData.thighCircumference} onChange={handleInputChange} {...commonNumericProps} />
            <InputGroup label={FIELD_LABELS_TH.CALF_CIRCUMFERENCE} name="calfCircumference" value={formData.calfCircumference} onChange={handleInputChange} {...commonNumericProps} />
            <InputGroup label={FIELD_LABELS_TH.WAIST_TO_ANKLE_LENGTH} name="waistToAnkleLength" value={formData.waistToAnkleLength} onChange={handleInputChange} {...commonNumericProps} />
            <InputGroup label={FIELD_LABELS_TH.ANKLE_CIRCUMFERENCE} name="ankleCircumference" value={formData.ankleCircumference} onChange={handleInputChange} {...commonNumericProps} />
            <InputGroup label={FIELD_LABELS_TH.CROTCH_DEPTH} name="crotchDepth" value={formData.crotchDepth} onChange={handleInputChange} {...commonNumericProps} />
        </div>
      </section>

      {/* Notes & Fabric */}
      <section className="mb-10">
        <h3 className="text-xl font-semibold text-sky-600 mb-6 pb-2 border-b-2 border-sky-200">{FIELD_LABELS_TH.NOTES_FABRIC_TITLE}</h3>
        <InputGroup label={FIELD_LABELS_TH.NOTES} name="notes" value={formData.notes} onChange={handleInputChange} isTextarea placeholder="เช่น เน้นเข้ารูป, เพิ่มซับใน, ฯลฯ"/>
        <InputGroup label={FIELD_LABELS_TH.FABRIC_SAMPLE_DESCRIPTION} name="fabricSampleDescription" value={formData.fabricSampleDescription} onChange={handleInputChange} isTextarea placeholder="เช่น ผ้าไหมสีฟ้าลายดอก, ลูกค้านำผ้ามาเอง, ต้องการแบบคล้ายรูปตัวอย่างที่ส่งมา"/>
      </section>

      <div className="flex flex-col sm:flex-row justify-end space-y-4 sm:space-y-0 sm:space-x-4 mt-12">
        <button
          type="button"
          onClick={onCancel}
          className="px-8 py-4 text-lg font-semibold rounded-lg border border-slate-400 text-slate-700 hover:bg-slate-100 transition duration-150 w-full sm:w-auto"
        >
          {FIELD_LABELS_TH.CANCEL_BUTTON}
        </button>
        <button
          type="submit"
          className="px-8 py-4 text-lg font-semibold rounded-lg bg-sky-600 text-white hover:bg-sky-700 transition duration-150 w-full sm:w-auto"
        >
          {existingMeasurement ? FIELD_LABELS_TH.UPDATE_BUTTON : FIELD_LABELS_TH.SAVE_BUTTON}
        </button>
      </div>
    </form>
  );
};

export default MeasurementForm;