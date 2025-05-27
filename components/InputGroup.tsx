
import React from 'react';
import type { CustomerMeasurement } from '../types';

interface InputGroupProps {
  label: string;
  name: keyof CustomerMeasurement | string; // Allow string for non-CustomerMeasurement keys like unit selector
  value: string;
  onChange: (name: keyof CustomerMeasurement | string, value: string) => void;
  placeholder?: string;
  type?: string;
  inputMode?: "none" | "text" | "tel" | "url" | "email" | "numeric" | "decimal" | "search";
  isTextarea?: boolean;
  unitSuffix?: string; // Changed from 'unit' to 'unitSuffix' to avoid conflict and be more descriptive
}

const InputGroup: React.FC<InputGroupProps> = ({ label, name, value, onChange, placeholder, type = "text", inputMode = "text", isTextarea = false, unitSuffix }) => {
  const commonInputClass = "mt-1 block w-full px-4 py-3 border border-slate-400 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-sky-500 text-lg bg-white text-slate-900 placeholder-slate-400";

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    onChange(name as keyof CustomerMeasurement, e.target.value);
  };

  return (
    <div className="mb-6">
      <label htmlFor={name} className="block text-lg font-medium text-slate-700 mb-1">
        {label}
      </label>
      <div className="relative">
        {isTextarea ? (
          <textarea
            id={name}
            name={name}
            value={value}
            onChange={handleChange}
            className={`${commonInputClass} min-h-[80px]`}
            placeholder={placeholder || label}
            rows={3}
          />
        ) : (
          <input
            id={name}
            name={name}
            type={type}
            inputMode={inputMode}
            value={value}
            onChange={handleChange}
            className={`${commonInputClass} ${unitSuffix ? 'pr-12' : ''}`} // Add padding if unit is present
            placeholder={placeholder || (type === 'number' ? '0' : label)}
          />
        )}
        {unitSuffix && !isTextarea && (
          <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
            <span className="text-slate-500 sm:text-lg">{unitSuffix}</span>
          </div>
        )}
      </div>
    </div>
  );
};

export default InputGroup;