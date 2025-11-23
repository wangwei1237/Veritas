import React from 'react';
import { VerificationItem, CheckStatus } from '../types';

interface ResultsTableProps {
  items: VerificationItem[];
}

const StatusBadge: React.FC<{ status: CheckStatus }> = ({ status }) => {
  const styles = {
    [CheckStatus.ACCURATE]: "bg-emerald-100 text-emerald-800 border-emerald-200",
    [CheckStatus.PARAPHRASED]: "bg-amber-100 text-amber-800 border-amber-200",
    [CheckStatus.MISATTRIBUTED]: "bg-red-100 text-red-800 border-red-200",
    [CheckStatus.UNVERIFIABLE]: "bg-gray-100 text-gray-800 border-gray-200",
  };

  const labels = {
    [CheckStatus.ACCURATE]: "准确",
    [CheckStatus.PARAPHRASED]: "意译",
    [CheckStatus.MISATTRIBUTED]: "错误归因",
    [CheckStatus.UNVERIFIABLE]: "存疑",
  };

  return (
    <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium border ${styles[status]}`}>
      {labels[status]}
    </span>
  );
};

const ResultsTable: React.FC<ResultsTableProps> = ({ items }) => {
  if (items.length === 0) return null;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden flex flex-col h-full">
      <div className="overflow-x-auto custom-scrollbar">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-24">
                位置
              </th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-1/4">
                引文内容 / 声称来源
              </th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-32">
                校验状态
              </th>
              <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                核查专家备注
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {items.map((item, index) => (
              <tr key={index} className="hover:bg-gray-50 transition-colors">
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 align-top">
                  {item.location}
                </td>
                <td className="px-6 py-4 text-sm text-gray-700 align-top space-y-1">
                  <div className="font-serif italic text-gray-900 border-l-2 border-accent pl-3">
                    "{item.quote_text}"
                  </div>
                  <div className="text-xs text-gray-500 pl-3">
                    声称来源: <span className="font-medium">{item.claimed_source || "未指明"}</span>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap align-top">
                  <StatusBadge status={item.status as CheckStatus} />
                </td>
                <td className="px-6 py-4 text-sm text-gray-600 align-top leading-relaxed">
                  {item.notes}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default ResultsTable;