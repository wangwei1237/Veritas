import React, { useState, useMemo, useEffect } from 'react';
import { verifyManuscript } from './services/geminiService';
import ResultsTable from './components/ResultsTable';
import StatsChart from './components/StatsChart';
import { VerificationItem, AnalysisStats, CheckStatus } from './types';
// @ts-ignore
import * as pdfjsLibProxy from 'pdfjs-dist';
// @ts-ignore
import * as mammothProxy from 'mammoth';

// Handle ESM default import interop
// The library might be on the 'default' property of the imported namespace
const pdfjsLib = (pdfjsLibProxy as any).default || pdfjsLibProxy;
const mammoth = (mammothProxy as any).default || mammothProxy;

// Initialize PDF worker
// We check if GlobalWorkerOptions exists to avoid "Cannot set properties of undefined"
if (pdfjsLib && !pdfjsLib.GlobalWorkerOptions) {
  pdfjsLib.GlobalWorkerOptions = {};
}
if (pdfjsLib && pdfjsLib.GlobalWorkerOptions) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://esm.sh/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
}

// Approx 30k chars per chunk to fit comfortably within output token limits for citations
const CHUNK_SIZE = 30000;

const App: React.FC = () => {
  const [inputText, setInputText] = useState<string>("");
  const [results, setResults] = useState<VerificationItem[]>([]);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [isParsing, setIsParsing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  
  // State for API Key
  const [apiKey, setApiKey] = useState<string>("");

  // Load API Key from local storage on mount
  useEffect(() => {
    const storedKey = localStorage.getItem('gemini_api_key');
    if (storedKey) {
      setApiKey(storedKey);
    }
  }, []);

  const handleApiKeyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newKey = e.target.value;
    setApiKey(newKey);
    localStorage.setItem('gemini_api_key', newKey);
  };

  // Calculate stats derived from results
  const stats: AnalysisStats = useMemo(() => {
    const s = {
      accurate: 0,
      paraphrased: 0,
      misattributed: 0,
      unverifiable: 0,
      total: results.length,
    };
    results.forEach((r) => {
      const status = r.status as CheckStatus;
      if (status === CheckStatus.ACCURATE) s.accurate++;
      else if (status === CheckStatus.PARAPHRASED) s.paraphrased++;
      else if (status === CheckStatus.MISATTRIBUTED) s.misattributed++;
      else if (status === CheckStatus.UNVERIFIABLE) s.unverifiable++;
    });
    return s;
  }, [results]);

  const parsePdf = async (arrayBuffer: ArrayBuffer): Promise<string> => {
    try {
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      let fullText = "";
      
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        // @ts-ignore
        const pageText = textContent.items.map((item) => item.str).join(' ');
        
        // Add page marker clearly for the LLM
        fullText += `\n[P${i}]\n${pageText}\n\n`;
      }
      return fullText;
    } catch (e) {
      console.error("PDF Parsing Error", e);
      throw new Error("Failed to parse PDF file.");
    }
  };

  const parseDocx = async (arrayBuffer: ArrayBuffer): Promise<string> => {
    try {
      const result = await mammoth.extractRawText({ arrayBuffer });
      // DOCX doesn't have strict page numbers in raw text extraction
      return `[Word Document Content]\n${result.value}`;
    } catch (e) {
      console.error("DOCX Parsing Error", e);
      throw new Error("Failed to parse Word file.");
    }
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setError(null);
    setIsParsing(true);
    setInputText(""); // Clear previous text immediately
    setResults([]); // Clear previous results

    try {
      let text = "";
      if (file.type === "application/pdf") {
        const arrayBuffer = await file.arrayBuffer();
        text = await parsePdf(arrayBuffer);
      } else if (file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
        const arrayBuffer = await file.arrayBuffer();
        text = await parseDocx(arrayBuffer);
      } else {
        // Fallback for text/md
        text = await file.text();
      }
      setInputText(text);
    } catch (err) {
      setError("Error parsing file. Please ensure it is a valid PDF, DOCX, or Text file.");
      setFileName(null);
    } finally {
      setIsParsing(false);
    }
  };

  const createChunks = (text: string, size: number): { text: string, startIndex: number }[] => {
    const chunks = [];
    let i = 0;
    while (i < text.length) {
      let end = Math.min(i + size, text.length);
      // Try to break at a paragraph (newline) to maintain context
      if (end < text.length) {
        const lastNewline = text.lastIndexOf('\n', end);
        // Ensure we don't go back too far (e.g., max 10% of chunk size)
        if (lastNewline > i + (size * 0.9)) {
          end = lastNewline;
        }
      }
      chunks.push({ text: text.slice(i, end), startIndex: i });
      i = end;
    }
    return chunks;
  };

  const handleAnalyze = async () => {
    if (!apiKey) {
      setError("Please configure your Gemini API Key first.");
      return;
    }
    if (!inputText.trim()) {
      setError("Please input or upload text to verify.");
      return;
    }
    setError(null);
    setIsProcessing(true);
    setResults([]);
    setProgress(null);

    try {
      const chunks = createChunks(inputText, CHUNK_SIZE);
      setProgress({ current: 0, total: chunks.length });

      // Process chunks sequentially
      for (let i = 0; i < chunks.length; i++) {
        let chunkContent = chunks[i].text;
        
        // Look back in the full text to find the last page marker if this chunk doesn't start with one
        // This helps the model know which page it's currently on
        if (i > 0) {
           const textBefore = inputText.slice(0, chunks[i].startIndex);
           const matches = [...textBefore.matchAll(/\[P(\d+)\]/g)];
           if (matches.length > 0) {
             const lastPage = matches[matches.length - 1][0]; // e.g., "[P5]"
             chunkContent = `(Context: Continued from ${lastPage})\n` + chunkContent;
           }
        }

        const chunkResults = await verifyManuscript(chunkContent, apiKey);
        setResults(prev => [...prev, ...chunkResults]);
        setProgress({ current: i + 1, total: chunks.length });
      }
    } catch (err) {
      console.error("Batch processing error", err);
      setError("Verification process encountered an error. Please check your API Key and try again.");
    } finally {
      setIsProcessing(false);
      setProgress(null);
    }
  };

  const handleExportCSV = () => {
    if (results.length === 0) return;

    // Define CSV headers
    const headers = ["Location", "Quote", "Claimed Source", "Status", "Notes"];
    
    // Convert results to CSV rows
    const rows = results.map(item => {
      // Escape quotes within content by doubling them
      const escape = (str: string) => `"${(str || '').replace(/"/g, '""')}"`;
      return [
        escape(item.location),
        escape(item.quote_text),
        escape(item.claimed_source),
        escape(item.status),
        escape(item.notes)
      ].join(",");
    });

    const csvContent = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `veritas_report_${new Date().toISOString().slice(0,10)}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Helper to handle textarea display for massive files
  const displayText = useMemo(() => {
    if (inputText.length > 50000) {
      return inputText.slice(0, 50000) + "\n\n... [Content Truncated for Display Performance] ...";
    }
    return inputText;
  }, [inputText]);

  return (
    <div className="min-h-screen bg-gray-50 font-sans text-ink flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-accent rounded-md flex items-center justify-center text-white font-serif font-bold text-xl">
              V
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900 tracking-tight">Veritas</h1>
              <p className="text-xs text-gray-500 uppercase tracking-wide">Editorial Fact Checker</p>
            </div>
          </div>
          <div className="text-sm text-gray-500">
            Powered by Gemini 3.0 Pro
          </div>
        </div>
      </header>

      <main className="flex-grow max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          
          {/* Left Column: Input */}
          <div className="lg:col-span-4 space-y-6">
            
            {/* API Key Configuration */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
               <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                Configuration
              </h2>
              <div className="space-y-2">
                <label htmlFor="api-key" className="block text-sm font-medium text-gray-700">
                  Gemini API Key
                </label>
                <div className="relative rounded-md shadow-sm">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <svg className="h-5 w-5 text-gray-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                      <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                    </svg>
                  </div>
                  <input
                    type="password"
                    name="api-key"
                    id="api-key"
                    className="focus:ring-accent focus:border-accent block w-full pl-10 sm:text-sm border-gray-300 rounded-md py-2 border"
                    placeholder="Enter your API Key"
                    value={apiKey}
                    onChange={handleApiKeyChange}
                  />
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  Your API key is stored locally in your browser.
                </p>
              </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                <svg className="w-5 h-5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                Manuscript Input
              </h2>
              
              <div className="space-y-4">
                <div className="border-2 border-dashed border-gray-300 rounded-lg p-4 hover:bg-gray-50 transition-colors text-center cursor-pointer relative group">
                  <input 
                    type="file" 
                    accept=".txt,.md,.pdf,.docx" 
                    onChange={handleFileChange}
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                  />
                  <div className="space-y-1 group-hover:opacity-75 transition-opacity">
                    {isParsing ? (
                       <div className="flex flex-col items-center justify-center py-2">
                         <svg className="animate-spin h-6 w-6 text-accent mb-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                          </svg>
                          <p className="text-sm font-medium text-gray-700">Parsing Document...</p>
                       </div>
                    ) : (
                      <>
                        <svg className="mx-auto h-8 w-8 text-gray-400" stroke="currentColor" fill="none" viewBox="0 0 48 48">
                          <path d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8m-12 4h.02" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        <p className="text-sm text-gray-600">
                          {fileName ? (
                            <span className="text-accent font-medium">{fileName}</span>
                          ) : (
                            "Upload .pdf, .docx, .txt"
                          )}
                        </p>
                      </>
                    )}
                  </div>
                </div>
                
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 top-3 pl-3 pointer-events-none">
                   <span className="text-gray-400 text-xs font-mono">
                     {inputText ? inputText.length.toLocaleString() : '0'} chars
                   </span>
                  </div>
                  <textarea
                    value={displayText}
                    onChange={(e) => setInputText(e.target.value)}
                    placeholder="Extracted text will appear here. You can also paste directly..."
                    disabled={isParsing}
                    readOnly={inputText.length > 50000}
                    className={`w-full h-64 p-3 pl-20 bg-gray-50 border border-gray-300 rounded-lg focus:ring-2 focus:ring-accent focus:border-accent resize-none font-serif text-sm leading-relaxed text-gray-800 placeholder-gray-400 ${isParsing ? 'opacity-50' : ''}`}
                  />
                  {inputText.length > 50000 && (
                    <div className="absolute bottom-2 right-2 text-xs bg-yellow-100 text-yellow-800 px-2 py-1 rounded">
                      Display Truncated
                    </div>
                  )}
                </div>

                <button
                  onClick={handleAnalyze}
                  disabled={isProcessing || isParsing || !inputText || !apiKey}
                  className={`w-full py-3 px-4 rounded-lg text-white font-medium shadow-md transition-all flex items-center justify-center gap-2
                    ${isProcessing || isParsing || !inputText || !apiKey
                      ? 'bg-gray-400 cursor-not-allowed' 
                      : 'bg-gray-900 hover:bg-accent'
                    }`}
                >
                  {isProcessing ? (
                    <>
                      <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Stop
                    </>
                  ) : (
                    'Run Verification'
                  )}
                </button>
                
                {isProcessing && progress && (
                  <div className="space-y-2 animate-in fade-in slide-in-from-top-1">
                    <div className="flex justify-between text-xs text-gray-500 font-medium">
                      <span>Analyzing segment {progress.current} of {progress.total}</span>
                      <span>{Math.round((progress.current / progress.total) * 100)}%</span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
                      <div 
                        className="bg-accent h-2 rounded-full transition-all duration-500 ease-out"
                        style={{ width: `${(progress.current / progress.total) * 100}%` }}
                      ></div>
                    </div>
                    <p className="text-xs text-gray-400 text-center">Large files are processed in chunks to ensure accuracy.</p>
                  </div>
                )}

                {error && (
                   <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-600">
                     {error}
                   </div>
                )}
              </div>
            </div>

            <StatsChart stats={stats} />
          </div>

          {/* Right Column: Results */}
          <div className="lg:col-span-8">
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 h-full min-h-[600px] flex flex-col">
              <div className="p-6 border-b border-gray-200 flex items-center justify-between bg-gray-50 rounded-t-xl">
                <h2 className="text-lg font-semibold text-gray-900">Verification Report</h2>
                <div className="flex gap-2 items-center">
                   {isProcessing && (
                      <span className="px-3 py-1 bg-blue-100 text-blue-700 text-xs rounded-full font-medium flex items-center gap-1">
                        <span className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></span>
                        Live
                      </span>
                   )}
                   {results.length > 0 && (
                      <button 
                        onClick={handleExportCSV}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-accent transition-colors"
                      >
                         <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                           <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                         </svg>
                         Export CSV
                      </button>
                   )}
                   {results.length > 0 && (
                      <span className="px-3 py-1 bg-gray-200 text-gray-700 text-xs rounded-full font-medium ml-2">
                        {results.length} citations
                      </span>
                   )}
                </div>
              </div>
              
              <div className="flex-grow p-0 relative">
                {results.length === 0 && !isProcessing ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-8">
                      <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4 text-gray-300">
                        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                        </svg>
                      </div>
                      <p className="text-gray-500 text-sm">
                        Configure your API Key and upload a manuscript to generate a fact-checking report.
                      </p>
                  </div>
                ) : (
                  <ResultsTable items={results} />
                )}
              </div>
            </div>
          </div>

        </div>
      </main>
    </div>
  );
};

export default App;