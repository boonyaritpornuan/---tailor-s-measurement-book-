
import React from 'react';
import type { CustomerMeasurement } from '../types';
import { FIELD_LABELS_TH } from '../constants';

interface MeasurementCardProps {
  measurement: CustomerMeasurement;
  onEdit: (measurement: CustomerMeasurement) => void;
  onDelete: (id: string) => void;
}

const MeasurementCard: React.FC<MeasurementCardProps> = ({ measurement, onEdit, onDelete }) => {
  
  const formatMeasurementDate = (isoDate: string | undefined) => {
    if (!isoDate) return '-';
    try {
      // Attempt to parse as ISO date first (YYYY-MM-DD from input type="date")
      const dateObj = new Date(isoDate + 'T00:00:00'); // Ensure it's parsed as local date
      if (isNaN(dateObj.getTime())) {
         // Fallback for potentially different formats or if parsing failed
        const parts = isoDate.split('-');
        if (parts.length === 3) {
            const year = parseInt(parts[0]);
            const month = parseInt(parts[1]);
            const day = parseInt(parts[2]);
            if(!isNaN(year) && !isNaN(month) && !isNaN(day)) {
                 return new Date(year, month - 1, day).toLocaleDateString('th-TH', {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric',
                 });
            }
        }
        return isoDate; // Return original string if specific parsing fails
      }
      return dateObj.toLocaleDateString('th-TH', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      });
    } catch (e) {
      return isoDate; // Return original string on any error
    }
  };

  const displayMeasurementDate = formatMeasurementDate(measurement.measurementDate);
  const displayUnit = measurement.unit === 'cm' ? FIELD_LABELS_TH.UNIT_CM_SHORT : FIELD_LABELS_TH.UNIT_INCH_SHORT;
  
  const displayName = measurement.name || FIELD_LABELS_TH.NAME_MISSING;
  const displayNickname = measurement.nickname ? ` (${measurement.nickname})` : '';


  return (
    <div className="bg-white shadow-lg rounded-xl p-6 hover:shadow-xl transition-shadow duration-300">
      <h3 className="text-xl font-semibold text-sky-700 mb-2">
        {displayName}
        {displayNickname}
      </h3>
      <p className="text-slate-600 text-lg mb-1"><span className="font-medium">{FIELD_LABELS_TH.PHONE}:</span> {measurement.phone || '-'}</p>
      <p className="text-slate-600 text-lg mb-1"><span className="font-medium">{FIELD_LABELS_TH.DATE}:</span> {displayMeasurementDate}</p>
      <p className="text-slate-600 text-lg mb-4"><span className="font-medium">{FIELD_LABELS_TH.UNIT_USED_LABEL}</span> {displayUnit}</p>
      
      {measurement.notes && (
        <p className="text-slate-500 text-md mb-4 italic truncate">
          <span className="font-medium text-slate-600">{FIELD_LABELS_TH.NOTES}: </span>{measurement.notes}
        </p>
      )}

      <div className="mt-6 flex flex-col sm:flex-row sm:justify-end space-y-3 sm:space-y-0 sm:space-x-3">
        <button
          onClick={() => onEdit(measurement)}
          className="w-full sm:w-auto px-6 py-3 text-lg font-medium rounded-lg bg-sky-500 text-white hover:bg-sky-600 transition duration-150"
        >
          {FIELD_LABELS_TH.VIEW_DETAILS_BUTTON}
        </button>
        <button
          onClick={() => onDelete(measurement.id)}
          className="w-full sm:w-auto px-6 py-3 text-lg font-medium rounded-lg bg-red-500 text-white hover:bg-red-600 transition duration-150"
        >
          {FIELD_LABELS_TH.DELETE_BUTTON}
        </button>
      </div>
    </div>
  );
};

export default MeasurementCard;