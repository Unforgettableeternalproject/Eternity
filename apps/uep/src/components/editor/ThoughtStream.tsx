import React, { useState, useCallback, useMemo } from 'react';

// ── 型別 ─────────────────────────────────────────────────────────
interface ThoughtStreamProps {
  accent?: string;
  onPushToEditor?: (html: string) => void;
}

type Step = 'raw' | 'analyze_prompt' | 'analysis' | 'compose' | 'final';

interface ThoughtThread {
  id: string;
  label: string;
  content: string;
  connections: string[];
}

interface ThinkingPattern {
  style: string;
  description: string;
}

interface ThoughtState {
  mode: string;
  energy: string;
}

interface ThoughtAnalysis {
  core_threads: ThoughtThread[];
  thinking_pattern: ThinkingPattern;
  current_state: ThoughtState;
  flow_trace: string[];
  identity_reflection: string;
}

// ── 步驟定義 ─────────────────────────────────────────────────────
const STEPS: { id: Step; label: string; hint: string }[] = [
  { id: 'raw', label: '傾倒想法', hint: '把腦中的想法 raw 倒下來' },
  {
    id: 'analyze_prompt',
    label: '分析 Prompt',
    hint: '複製提示詞給 LLM，取得思維結構分析',
  },
  {
    id: 'analysis',
    label: '思維結構',
    hint: '貼回 JSON 分析結果，檢視思維脈絡',
  },
  {
    id: 'compose',
    label: '成文',
    hint: '複製成文提示詞給 LLM，貼回產出的文章',
  },
  { id: 'final', label: '最終稿', hint: '最終成品，可推入編輯器' },
];

// ── Prompt 模板 ──────────────────────────────────────────────────
const ANALYZE_PROMPT_TEMPLATE = `## System Instructions

You are a thinking-structure system. Your role is NOT to answer questions or generate content. Your role is to **reconstruct the structure of someone's raw thinking** into organized, faithful output.

### Context
- The user's raw thought capture follows below. It was written stream-of-consciousness, without editing.

### Rules
1. **Extract structure** — Identify core threads, branches, and connections in the thinking
2. **Preserve thinking style** — Do NOT flatten, simplify, or sanitize the original voice
3. **Avoid summarization** — This is reconstruction, not compression
4. **Reconstruct logic** — Show how ideas connect, loop, contradict, or build on each other
5. **Maintain original language** — If the input mixes languages, preserve that

### Required Output Format (JSON)
\`\`\`json
{
  "core_threads": [
    {
      "id": "thread_1",
      "label": "short label for this thinking thread",
      "content": "reconstructed content preserving original voice and logic",
      "connections": ["thread_2"]
    }
  ],
  "thinking_pattern": {
    "style": "e.g. spiral, linear, branching, oscillating",
    "description": "brief description of how this person thinks based on this capture"
  },
  "current_state": {
    "mode": "e.g. processing, deciding, exploring, stuck, flowing",
    "energy": "e.g. high, medium, low, mixed"
  },
  "flow_trace": [
    "started with...",
    "then moved to...",
    "circled back to..."
  ],
  "identity_reflection": "a single reflective sentence about what this thinking reveals about the thinker — written as mirror, not analysis"
}
\`\`\`

### Raw Thinking Input
------
{RAW_THOUGHT}
------

Process the above. Return ONLY the JSON output. Do not add commentary.`;

const COMPOSE_PROMPT_TEMPLATE = `You are a professional writer. You are given a structural analysis of someone's raw thinking, along with the original raw text. Your job is to **compose a polished, publication-ready article** — NOT a cleaned-up version of the raw text.

### What "compose" means
- You are writing a NEW article informed by the analysis, not editing the original text
- The final article should read as if written by a skilled author, not as stream-of-consciousness notes
- Add proper transitions between ideas, build arguments with evidence and reasoning
- Create a clear narrative arc: opening hook → development → resolution/insight
- Expand underdeveloped points with depth and nuance
- Condense repetitive or circular thinking into crisp statements

### Structure guidelines
1. Use the core_threads as thematic building blocks — synthesize and weave them, don't just list them
2. Use flow_trace to decide the most compelling narrative order (which may differ from the original order)
3. The thinking_pattern informs tone: a spiral thinker's article can revisit themes at deeper levels; a branching thinker's article can use parallel structure
4. The identity_reflection may serve as closing insight or epigraph — use it if it strengthens the piece
5. Aim for clear paragraphs, each with a single focus. Use subheadings if the article exceeds ~500 words

### Voice & language
- Retain the thinker's authentic perspective and convictions, but express them with clarity and precision
- Write in the same language(s) as the original input
- Elevate the register: replace vague phrasing with specific language, casual filler with purposeful prose
- This should feel like an essay or editorial, not a chat message

### Output
- Output the article directly — no preamble, no meta-commentary, no "here is your article"
- Do NOT include the structural analysis metadata (thread IDs, pattern labels, etc.) in the article

### Structural Analysis
------
{ANALYSIS_JSON}
------

### Original Raw Thinking
------
{RAW_THOUGHT}
------

Compose the article now.`;

// ── 輔助函式 ────────────────────────────────────────────────────
function tryParseAnalysis(text: string): ThoughtAnalysis | null {
  if (!text.trim()) return null;
  try {
    const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    const jsonStr = codeBlockMatch ? codeBlockMatch[1] : text.trim();
    const parsed = JSON.parse(jsonStr);
    if (parsed.core_threads && parsed.thinking_pattern)
      return parsed as ThoughtAnalysis;
    return null;
  } catch {
    return null;
  }
}

// ── 主元件 ───────────────────────────────────────────────────────
export default function ThoughtStream({
  accent = '#D5B618',
  onPushToEditor,
}: ThoughtStreamProps) {
  const [open, setOpen] = useState(false);
  const [activeStep, setActiveStep] = useState<Step>('raw');
  const [rawText, setRawText] = useState('');
  const [analyzePromptText, setAnalyzePromptText] = useState('');
  const [analysisText, setAnalysisText] = useState('');
  const [composePromptText, setComposePromptText] = useState('');
  const [articleText, setArticleText] = useState('');
  const [finalText, setFinalText] = useState('');
  const [copied, setCopied] = useState<string | false>(false);

  const parsedAnalysis = useMemo(
    () => tryParseAnalysis(analysisText),
    [analysisText]
  );

  const generateAnalyzePrompt = useCallback(() => {
    if (!rawText.trim()) return;
    setAnalyzePromptText(
      ANALYZE_PROMPT_TEMPLATE.replace('{RAW_THOUGHT}', rawText.trim())
    );
    setActiveStep('analyze_prompt');
  }, [rawText]);

  const getComposePrompt = useCallback(() => {
    if (!parsedAnalysis || !rawText.trim()) return '';
    return COMPOSE_PROMPT_TEMPLATE.replace(
      '{ANALYSIS_JSON}',
      JSON.stringify(parsedAnalysis, null, 2)
    ).replace('{RAW_THOUGHT}', rawText.trim());
  }, [parsedAnalysis, rawText]);

  const copyToClipboard = useCallback(async (text: string, label: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(false), 2000);
  }, []);

  const pushToEditor = useCallback(() => {
    if (!onPushToEditor || !finalText.trim()) return;
    const paragraphs = finalText.trim().split(/\n\n+/);
    const html = paragraphs
      .map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`)
      .join('');
    onPushToEditor(html);
  }, [finalText, onPushToEditor]);

  const wordCount = (text: string) => text.replace(/\s/g, '').length;

  if (!open) {
    return (
      <button
        className="ts-collapsed"
        onClick={() => setOpen(true)}
        style={{ '--ts-accent': accent } as React.CSSProperties}
      >
        <span className="ts-collapsed-icon">✎</span>
        <span className="ts-collapsed-label">ThoughtStream</span>
        <span className="ts-collapsed-hint">展開思緒整理工具</span>
        {rawText && (
          <span className="ts-collapsed-badge">{wordCount(rawText)} 字</span>
        )}
      </button>
    );
  }

  return (
    <div
      className="ts-panel"
      style={{ '--ts-accent': accent } as React.CSSProperties}
    >
      {/* 標題列 */}
      <div className="ts-header">
        <span className="ts-header-icon">✎</span>
        <span className="ts-header-title">ThoughtStream</span>
        <span className="ts-header-hint">
          raw thought → structure → article
        </span>
        <button className="ts-collapse-btn" onClick={() => setOpen(false)}>
          —
        </button>
      </div>

      {/* 步驟 tab */}
      <div className="ts-tabs">
        {STEPS.map((step, i) => (
          <button
            key={step.id}
            className={`ts-tab ${activeStep === step.id ? 'is-active' : ''}`}
            onClick={() => setActiveStep(step.id)}
          >
            <span className="ts-tab-num">{i + 1}</span>
            <span className="ts-tab-label">{step.label}</span>
          </button>
        ))}
      </div>

      {/* 步驟內容 */}
      <div className="ts-body">
        <div className="ts-step-hint">
          {STEPS.find((s) => s.id === activeStep)?.hint}
        </div>

        {/* Step 1: Raw */}
        {activeStep === 'raw' && (
          <>
            <textarea
              className="ts-textarea"
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
              placeholder="把想法倒在這裡，不用在意結構或文法..."
              rows={10}
            />
            <div className="ts-actions">
              <span className="ts-word-count">{wordCount(rawText)} 字</span>
              <button
                className="ts-action-btn ts-primary"
                onClick={generateAnalyzePrompt}
                disabled={!rawText.trim()}
              >
                生成分析 Prompt →
              </button>
            </div>
          </>
        )}

        {/* Step 2: Analyze Prompt */}
        {activeStep === 'analyze_prompt' && (
          <>
            <textarea
              className="ts-textarea ts-textarea-mono"
              value={analyzePromptText}
              onChange={(e) => setAnalyzePromptText(e.target.value)}
              placeholder="點上一步的「生成分析 Prompt」..."
              rows={12}
            />
            <div className="ts-actions">
              <button
                className="ts-action-btn"
                onClick={() => setActiveStep('raw')}
              >
                ← 回去改想法
              </button>
              <button
                className="ts-action-btn ts-primary"
                onClick={() => copyToClipboard(analyzePromptText, 'analyze')}
                disabled={!analyzePromptText.trim()}
              >
                {copied === 'analyze' ? '✓ 已複製' : '複製 Prompt'}
              </button>
              <button
                className="ts-action-btn"
                onClick={() => setActiveStep('analysis')}
              >
                下一步 →
              </button>
            </div>
          </>
        )}

        {/* Step 3: Analysis — JSON 貼入 + 視覺化卡片 */}
        {activeStep === 'analysis' && (
          <>
            <textarea
              className={`ts-textarea ts-textarea-mono ${parsedAnalysis ? 'ts-textarea-sm' : ''}`}
              value={analysisText}
              onChange={(e) => setAnalysisText(e.target.value)}
              placeholder="把 LLM 回傳的 JSON 貼在這裡..."
              rows={parsedAnalysis ? 4 : 10}
            />

            {parsedAnalysis && (
              <AnalysisCards analysis={parsedAnalysis} accent={accent} />
            )}

            {analysisText.trim() && !parsedAnalysis && (
              <div className="ts-parse-error">
                ⚠ 無法解析 JSON，請確認格式正確
              </div>
            )}

            <div className="ts-actions">
              <span className="ts-word-count">
                {parsedAnalysis
                  ? `${parsedAnalysis.core_threads.length} threads`
                  : `${wordCount(analysisText)} 字`}
              </span>
              <button
                className="ts-action-btn"
                onClick={async () => {
                  const prompt = getComposePrompt();
                  if (prompt) await copyToClipboard(prompt, 'compose');
                }}
                disabled={!parsedAnalysis}
              >
                {copied === 'compose'
                  ? '✓ 已複製成文 Prompt'
                  : '複製成文 Prompt'}
              </button>
              <button
                className="ts-action-btn ts-primary"
                onClick={() => {
                  setComposePromptText(getComposePrompt());
                  setActiveStep('compose');
                }}
                disabled={!parsedAnalysis}
              >
                下一步 →
              </button>
            </div>
          </>
        )}

        {/* Step 4: Compose — 成文提示詞 + 貼回文章 */}
        {activeStep === 'compose' && (
          <>
            <div className="ts-compose-section">
              <div className="ts-compose-bar">
                <span className="ts-compose-label">成文提示詞</span>
                <button
                  className="ts-action-btn"
                  onClick={() => copyToClipboard(composePromptText, 'compose2')}
                  disabled={!composePromptText}
                >
                  {copied === 'compose2' ? '✓ 已複製' : '複製 Prompt'}
                </button>
              </div>
              <textarea
                className="ts-textarea ts-textarea-mono ts-textarea-sm"
                value={composePromptText}
                onChange={(e) => setComposePromptText(e.target.value)}
                rows={4}
              />
            </div>

            <textarea
              className="ts-textarea"
              value={articleText}
              onChange={(e) => setArticleText(e.target.value)}
              placeholder="把 LLM 產出的文章貼在這裡..."
              rows={12}
            />
            <div className="ts-actions">
              <span className="ts-word-count">{wordCount(articleText)} 字</span>
              <button
                className="ts-action-btn"
                onClick={() => setActiveStep('analysis')}
              >
                ← 回到分析
              </button>
              <button
                className="ts-action-btn ts-primary"
                onClick={() => {
                  setFinalText(articleText);
                  setActiveStep('final');
                }}
                disabled={!articleText.trim()}
              >
                送到整理 →
              </button>
            </div>
          </>
        )}

        {/* Step 5: Final */}
        {activeStep === 'final' && (
          <>
            <textarea
              className="ts-textarea"
              value={finalText}
              onChange={(e) => setFinalText(e.target.value)}
              placeholder="在這裡做最後的修改..."
              rows={12}
            />
            <div className="ts-actions">
              <span className="ts-word-count">{wordCount(finalText)} 字</span>
              <button
                className="ts-action-btn"
                onClick={() => setActiveStep('compose')}
              >
                ← 回到成文
              </button>
              {onPushToEditor && (
                <button
                  className="ts-action-btn ts-primary"
                  onClick={pushToEditor}
                  disabled={!finalText.trim()}
                >
                  推入編輯器 ↓
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── 分析卡片元件 ────────────────────────────────────────────────
function AnalysisCards({
  analysis,
  accent,
}: {
  analysis: ThoughtAnalysis;
  accent: string;
}) {
  const [expandedThread, setExpandedThread] = useState<string | null>(null);

  return (
    <div className="ts-analysis">
      {/* 狀態 + 模式 + 思考風格 */}
      <div className="ts-analysis-meta">
        <div className="ts-meta-chip" style={{ borderColor: accent }}>
          <span className="ts-meta-label">mode</span>
          <span className="ts-meta-value">{analysis.current_state.mode}</span>
        </div>
        <div className="ts-meta-chip" style={{ borderColor: accent }}>
          <span className="ts-meta-label">energy</span>
          <span className="ts-meta-value">{analysis.current_state.energy}</span>
        </div>
        <div className="ts-meta-chip" style={{ borderColor: accent }}>
          <span className="ts-meta-label">pattern</span>
          <span className="ts-meta-value">
            {analysis.thinking_pattern.style}
          </span>
        </div>
      </div>

      {/* 思考模式描述 */}
      <div className="ts-pattern-desc">
        {analysis.thinking_pattern.description}
      </div>

      {/* 核心思緒線索 */}
      <div className="ts-section-label">
        核心思緒 · {analysis.core_threads.length} threads
      </div>
      <div className="ts-threads">
        {analysis.core_threads.map((thread) => (
          <div
            key={thread.id}
            className={`ts-thread ${expandedThread === thread.id ? 'is-expanded' : ''}`}
            onClick={() =>
              setExpandedThread(expandedThread === thread.id ? null : thread.id)
            }
          >
            <div className="ts-thread-header">
              <span className="ts-thread-id">{thread.id}</span>
              <span className="ts-thread-label">{thread.label}</span>
              {thread.connections.length > 0 && (
                <span className="ts-thread-conn">
                  → {thread.connections.join(', ')}
                </span>
              )}
              <span className="ts-thread-toggle">
                {expandedThread === thread.id ? '▾' : '▸'}
              </span>
            </div>
            {expandedThread === thread.id && (
              <div className="ts-thread-content">{thread.content}</div>
            )}
          </div>
        ))}
      </div>

      {/* 思維軌跡 */}
      <div className="ts-section-label">思維軌跡</div>
      <div className="ts-flow">
        {analysis.flow_trace.map((step, i) => (
          <div key={i} className="ts-flow-step">
            <span className="ts-flow-dot" style={{ background: accent }} />
            {i < analysis.flow_trace.length - 1 && (
              <span className="ts-flow-line" />
            )}
            <span className="ts-flow-text">{step}</span>
          </div>
        ))}
      </div>

      {/* 自我映射 */}
      <div className="ts-reflection">
        <span className="ts-reflection-mark" style={{ color: accent }}>
          "
        </span>
        <span className="ts-reflection-text">
          {analysis.identity_reflection}
        </span>
      </div>
    </div>
  );
}
