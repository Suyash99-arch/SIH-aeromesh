import React, { useState } from 'react';
import { MapPin, Eye, EyeOff, Trash2, Plus, ChevronDown, ChevronUp } from 'lucide-react';
import type { CustomMarking, MarkingType } from '../types';

interface CustomMarkingPanelProps {
  markings: CustomMarking[];
  onAddMarking: (marking: Omit<CustomMarking, 'id'>) => void;
  onDeleteMarking: (id: string) => void;
  onToggleVisibility: (id: string) => void;
}

export const CustomMarkingPanel: React.FC<CustomMarkingPanelProps> = ({
  markings,
  onAddMarking,
  onDeleteMarking,
  onToggleVisibility
}) => {
  const [name, setName] = useState<string>('');
  const [type, setType] = useState<MarkingType | ''>('');
  const [color, setColor] = useState<string>('#f59e0b');
  const [description, setDescription] = useState<string>('');
  const [isAddExpanded, setIsAddExpanded] = useState<boolean>(true);

  const colors = [
    { label: 'Yellow', value: '#f59e0b' },
    { label: 'Green', value: '#10b981' },
    { label: 'Cyan', value: '#00d2ff' },
    { label: 'Blue', value: '#2563eb' },
    { label: 'Purple', value: '#a855f7' },
  ];

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    // Pick random plausible bridge position for newly added custom marking
    const rx = (Math.random() - 0.5) * 6;
    const rz = (Math.random() - 0.5) * 8;

    onAddMarking({
      name: name.trim(),
      type: (type as MarkingType) || 'Custom',
      color: color,
      description: description.trim(),
      visible: true,
      position: [rx, 1.2, rz],
      iconType: type === 'Hazard' ? 'fire' : type === 'Damage' ? 'warning' : 'pin'
    });

    setName('');
    setType('');
    setDescription('');
  };

  return (
    <div className="w-72 h-full bg-[#050c1f]/95 backdrop-blur-md border-l border-[#0f244a] p-3.5 flex flex-col justify-between overflow-y-auto">
      <div className="space-y-4">
        
        {/* Header */}
        <div className="flex items-center justify-between pb-2 border-b border-[#132244]">
          <div className="flex items-center gap-2 text-xs font-bold text-white">
            <MapPin className="w-3.5 h-3.5 text-cyan-400" />
            <span>Add Custom Marking</span>
          </div>
          <button
            type="button"
            onClick={() => setIsAddExpanded(!isAddExpanded)}
            className="text-slate-400 hover:text-white"
          >
            {isAddExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>

        {/* Add Marking Form */}
        {isAddExpanded && (
          <form onSubmit={handleAdd} className="space-y-3">
            {/* Marking Name */}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-slate-300">
                Marking Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Temporary Shelter"
                className="w-full px-2.5 py-1.5 rounded-lg bg-[#0a1326] border border-[#1b2f5b] focus:border-cyan-400 text-xs text-white focus:outline-none"
              />
            </div>

            {/* Marking Type */}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-slate-300">
                Marking Type
              </label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as MarkingType)}
                className="w-full px-2.5 py-1.5 rounded-lg bg-[#0a1326] border border-[#1b2f5b] focus:border-cyan-400 text-xs text-slate-200 focus:outline-none"
              >
                <option value="">Select Type</option>
                <option value="Entry Point">Entry Point</option>
                <option value="Damage">Damage</option>
                <option value="Temporary shelter">Temporary shelter</option>
                <option value="Hazard">Hazard</option>
                <option value="Landmark">Landmark</option>
                <option value="Water">Water</option>
                <option value="Custom">Custom</option>
              </select>
            </div>

            {/* Color Swatches */}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-slate-300">
                Color
              </label>
              <div className="flex items-center gap-2">
                {colors.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => setColor(c.value)}
                    className={`w-5 h-5 rounded-full transition-transform ${
                      color === c.value ? 'scale-125 ring-2 ring-white shadow-[0_0_8px_rgba(255,255,255,0.8)]' : 'opacity-80 hover:opacity-100'
                    }`}
                    style={{ backgroundColor: c.value }}
                    title={c.label}
                  />
                ))}
              </div>
            </div>

            {/* Description */}
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-slate-300">
                Description (Optional)
              </label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Add description..."
                className="w-full px-2.5 py-1.5 rounded-lg bg-[#0a1326] border border-[#1b2f5b] focus:border-cyan-400 text-xs text-white focus:outline-none"
              />
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={!name.trim()}
              className="w-full py-2 px-3 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold text-xs transition-colors shadow-[0_0_12px_rgba(37,99,235,0.4)] flex items-center justify-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Marking</span>
            </button>
          </form>
        )}

        {/* Saved Markings List (Screenshot 4) */}
        <div className="pt-2 border-t border-[#132244]">
          <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">
            Saved Markings
          </h4>

          <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
            {markings.map((m) => (
              <div
                key={m.id}
                className="p-2 rounded-lg bg-[#0a1326] border border-[#172a54] flex items-center justify-between group hover:border-cyan-500/40 transition-colors"
              >
                <div className="flex items-center gap-2 overflow-hidden">
                  <span 
                    className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: m.color }}
                  />
                  <div className="truncate">
                    <p className="text-xs font-semibold text-slate-200 truncate">{m.name}</p>
                    <p className="text-[10px] text-slate-500 truncate">{m.type}</p>
                  </div>
                </div>

                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => onToggleVisibility(m.id)}
                    className="p-1 text-slate-400 hover:text-cyan-400 transition-colors"
                    title={m.visible ? 'Hide marking' : 'Show marking'}
                  >
                    {m.visible ? <Eye className="w-3.5 h-3.5 text-cyan-400" /> : <EyeOff className="w-3.5 h-3.5 text-slate-600" />}
                  </button>

                  <button
                    type="button"
                    onClick={() => onDeleteMarking(m.id)}
                    className="p-1 text-slate-400 hover:text-rose-400 transition-colors"
                    title="Delete marking"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
};
