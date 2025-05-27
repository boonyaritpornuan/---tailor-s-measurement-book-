
import React, { useState, useMemo } from 'react';
import type { CustomerMeasurement } from '../types';
import { FIELD_LABELS_TH } from '../constants';
import MeasurementCard from './MeasurementCard';

interface MeasurementListProps {
  measurements: CustomerMeasurement[];
  onAddNew: () => void;
  onEdit: (measurement: CustomerMeasurement) => void;
  onDelete: (id: string) => void;
}

const MeasurementList: React.FC<MeasurementListProps> = ({ measurements, onAddNew, onEdit, onDelete }) => {
  const [searchTerm, setSearchTerm] = useState('');

  const filteredMeasurements = useMemo(() => {
    if (!searchTerm.trim()) {
      return measurements;
    }
    const lowerCaseSearchTerm = searchTerm.toLowerCase();
    return measurements.filter(m => {
      const nameMatch = m.name && m.name.toLowerCase().includes(lowerCaseSearchTerm);
      const nicknameMatch = m.nickname && m.nickname.toLowerCase().includes(lowerCaseSearchTerm);
      const phoneMatch = m.phone && m.phone.toLowerCase().includes(lowerCaseSearchTerm);
      return nameMatch || nicknameMatch || phoneMatch;
    });
  }, [measurements, searchTerm]);

  let listContent;
  if (measurements.length === 0) {
    listContent = (
      <p className="text-slate-600 text-xl text-center py-10 bg-white rounded-lg shadow">
        {FIELD_LABELS_TH.NO_RECORDS}
      </p>
    );
  } else if (filteredMeasurements.length === 0) {
    listContent = (
      <p className="text-slate-600 text-xl text-center py-10 bg-white rounded-lg shadow">
        {FIELD_LABELS_TH.NO_MATCHING_RECORDS_FOUND} "{searchTerm}"
      </p>
    );
  } else {
    listContent = (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredMeasurements.map(m => (
          <MeasurementCard key={m.id} measurement={m} onEdit={onEdit} onDelete={onDelete} />
        ))}
      </div>
    );
  }

  return (
    <div className="w-full">
      <div className="flex flex-col sm:flex-row justify-between items-center mb-6">
        <h2 className="text-2xl md:text-3xl font-bold text-sky-700 mb-4 sm:mb-0">
          {FIELD_LABELS_TH.CUSTOMER_RECORDS} ({filteredMeasurements.length})
        </h2>
        <button
          onClick={onAddNew}
          className="px-8 py-4 text-lg font-semibold rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition duration-150 shadow-md hover:shadow-lg w-full sm:w-auto"
        >
          {FIELD_LABELS_TH.ADD_NEW_MEASUREMENT}
        </button>
      </div>

      <div className="mb-8">
        <input
          type="text"
          placeholder={FIELD_LABELS_TH.SEARCH_PLACEHOLDER}
          className="w-full px-4 py-3 border border-slate-400 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-sky-500 text-lg placeholder-slate-400 bg-white"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          aria-label={FIELD_LABELS_TH.SEARCH_PLACEHOLDER}
        />
      </div>

      {listContent}
    </div>
  );
};

export default MeasurementList;