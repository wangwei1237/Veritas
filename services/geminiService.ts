import { GoogleGenAI, Type } from "@google/genai";
import { VerificationItem } from "../types";

const getGeminiClient = (apiKey: string) => {
  if (!apiKey) {
    console.error("API_KEY is missing.");
    throw new Error("API Configuration Error: Missing API Key.");
  }
  return new GoogleGenAI({ apiKey });
};

// Helper to remove Markdown code blocks if the model includes them
const cleanJson = (text: string): string => {
  let clean = text.trim();
  // Remove wrapping ```json ... ``` or ``` ... ```
  if (clean.startsWith('```json')) {
    clean = clean.replace(/^```json\s*/, '').replace(/\s*```$/, '');
  } else if (clean.startsWith('```')) {
    clean = clean.replace(/^```\s*/, '').replace(/\s*```$/, '');
  }
  return clean;
};

export const verifyManuscript = async (text: string, apiKey: string): Promise<VerificationItem[]> => {
  const ai = getGeminiClient(apiKey);

  const prompt = `
    作为一位拥有20年经验的资深图书编辑和事实核查专家，请审查以下文本片段。
    
    任务目标：
    1. 扫描文本，提取所有的直接引语（引号内容）或间接引语（如“正如...所说”）。
    2. 校验引文的真实性、归属者及出处。
    
    关键要求：
    - **位置定位**：文本中可能包含页码标记（如 [P1], [P2]）。请务必在返回的 'location' 字段中注明具体的页码和该页的第几段（例如："Page 5, Para 2" 或 "[P5] 第2段"）。如果片段开头注明了"(Context: Continued from [P...])"，请以此作为起始页码依据。
    
    输入文本片段：
    "${text}"
    
    判定标准：
    - ACCURATE (准确): 内容与原文高度一致。
    - PARAPHRASED (意译/版本差异): 核心意思一致，但文字表述不同（常见于不同译本）。
    - MISATTRIBUTED (错误归因): 引文存在，但作者或书名张冠李戴。
    - UNVERIFIABLE (伪造/无法验证/存疑): 未找到可靠来源，可能是伪造或杜撰。

    请返回一个JSON数组。
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-pro-preview",
      contents: prompt,
      config: {
        systemInstruction: "你是一个严格的事实核查系统。只输出JSON，不包含任何Markdown格式标记。如果片段中没有发现引文，返回空数组 []。",
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              location: {
                type: Type.STRING,
                description: "精确位置，必须包含页码和段落 (例如: 'Page 12, Para 3')",
              },
              quote_text: {
                type: Type.STRING,
                description: "文中引用的原话 (Short snippet)",
              },
              claimed_source: {
                type: Type.STRING,
                description: "文中提到的作者或书名",
              },
              status: {
                type: Type.STRING,
                enum: ["ACCURATE", "PARAPHRASED", "MISATTRIBUTED", "UNVERIFIABLE"],
                description: "核查状态",
              },
              notes: {
                type: Type.STRING,
                description: "详细的核查备注，包含原文对比或纠正建议",
              },
            },
            required: ["location", "quote_text", "status", "notes"],
          },
        },
      },
    });

    const jsonText = response.text;
    if (!jsonText) return [];
    
    try {
      const cleanedJson = cleanJson(jsonText);
      return JSON.parse(cleanedJson) as VerificationItem[];
    } catch (parseError) {
      console.warn("JSON Parse Warning: Model output might be malformed", jsonText);
      // Return empty array instead of throwing to prevent failing the entire batch process
      return [];
    }
  } catch (error) {
    console.error("Gemini Analysis Failed:", error);
    // For network errors, we might want to propagate to stop the batch or implement retry logic
    throw error;
  }
};