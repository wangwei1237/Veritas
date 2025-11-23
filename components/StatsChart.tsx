import React from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import { AnalysisStats, CheckStatus } from '../types';

interface StatsChartProps {
  stats: AnalysisStats;
}

const COLORS = {
  [CheckStatus.ACCURATE]: '#10b981', // emerald-500
  [CheckStatus.PARAPHRASED]: '#f59e0b', // amber-500
  [CheckStatus.MISATTRIBUTED]: '#ef4444', // red-500
  [CheckStatus.UNVERIFIABLE]: '#6b7280', // gray-500
};

const StatsChart: React.FC<StatsChartProps> = ({ stats }) => {
  const data = [
    { name: '准确 (Accurate)', value: stats.accurate, color: COLORS[CheckStatus.ACCURATE] },
    { name: '意译 (Paraphrased)', value: stats.paraphrased, color: COLORS[CheckStatus.PARAPHRASED] },
    { name: '错误归因 (Misattributed)', value: stats.misattributed, color: COLORS[CheckStatus.MISATTRIBUTED] },
    { name: '存疑 (Unverifiable)', value: stats.unverifiable, color: COLORS[CheckStatus.UNVERIFIABLE] },
  ].filter(item => item.value > 0);

  if (stats.total === 0) return null;

  return (
    <div className="h-64 w-full bg-white rounded-xl shadow-sm border border-gray-100 p-4 flex flex-col items-center justify-center">
      <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-2">Quality Distribution</h3>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={60}
            outerRadius={80}
            paddingAngle={5}
            dataKey="value"
          >
            {data.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.color} />
            ))}
          </Pie>
          <Tooltip 
            contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
          />
          <Legend verticalAlign="bottom" height={36} iconType="circle" />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
};

export default StatsChart;