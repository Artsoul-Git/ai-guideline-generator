/* ========================================================================
   AIガイドライン・ジェネレーター ─ 中核ロジック
   ・規模自動判定
   ・業種→条項推奨
   ・条項マッチング
   ・出力エンジン（HTML/Word/PDF/.md/要件定義書）
   ======================================================================== */

(function(global) {
  const STORAGE_KEY = 'aigl_v1_state';
  const GENERATOR_VERSION = '1.0.0';

  // DB（runtime load）
  let META = null, CLAUSES = null, TEMPLATES = null, GLOSSARY = null;

  // 状態
  const state = {
    step: 1,
    company_name: '',
    industry_self: '',
    employee_count: 0,
    scale: '',
    industries: [],
    contact_name: '',
    contact_email: '',
    audience_type: 'tiered',
    ai_tools: [],
    ai_purposes: [],
    data_types: [],
    masking_scenes: '',
    existing_rules: [],
    output_formats: [],
    selected_clauses: [],
    creation_date: '',
    version: '1.0.0'
  };

  // === DBロード ===
  async function loadDB() {
    try {
      const [meta, clauses, templates, glossary] = await Promise.all([
        fetch('_data/meta.json').then(r => r.json()),
        fetch('_data/clauses.json').then(r => r.json()),
        fetch('_data/templates.json').then(r => r.json()),
        fetch('_data/glossary.json').then(r => r.json())
      ]);
      META = meta;
      CLAUSES = clauses.clauses;
      TEMPLATES = templates;
      GLOSSARY = glossary;
      console.log('[AIGL] DB loaded:', {
        scale_patterns: META.scale_patterns.length,
        industries: META.industries.length,
        clauses: CLAUSES.length
      });
      return true;
    } catch (e) {
      console.error('[AIGL] DB load failed:', e);
      alert('データファイルの読み込みに失敗しました。フォルダ構成を確認してください。\n\n_data/ フォルダに meta.json, clauses.json, templates.json, glossary.json が必要です。');
      return false;
    }
  }

  // === 規模自動判定 ===
  function calculateScale(employees) {
    employees = parseInt(employees) || 0;
    if (employees <= 0) return '';
    if (employees === 1) return 'S';
    if (employees <= 10) return 'XS';
    if (employees <= 30) return 'S2';
    if (employees <= 100) return 'M';
    return 'L';
  }

  function getScaleMeta(scaleId) {
    return META.scale_patterns.find(s => s.id === scaleId);
  }

  function getIndustryMeta(industryId) {
    return META.industries.find(i => i.id === industryId);
  }

  // === 業種→条項推奨 ===
  function recommendClauses(scale, industries) {
    if (!scale || !CLAUSES) return [];
    const recommended = new Set();

    CLAUSES.forEach(c => {
      const scaleMatch = c.applies_to_scale.includes(scale);
      const industryMatch =
        c.applies_to_industry.includes('*') ||
        (industries && industries.some(i => c.applies_to_industry.includes(i)));
      if (scaleMatch && industryMatch) {
        recommended.add(c.id);
      }
    });

    // 必須条項は常に追加（依存解決の代わり）
    return Array.from(recommended);
  }

  function getClauseById(id) {
    return CLAUSES.find(c => c.id === id);
  }

  function classifyClauses(clauseIds) {
    const result = { required: [], recommended: [], optional: [] };
    clauseIds.forEach(id => {
      const c = getClauseById(id);
      if (!c) return;
      if (c.necessity === 'required') result.required.push(c);
      else if (c.necessity === 'recommended') result.recommended.push(c);
      else result.optional.push(c);
    });
    return result;
  }

  // === 状態保存・復元 ===
  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ savedAt: new Date().toISOString(), state }));
    } catch (e) { /* ignore */ }
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) { return null; }
  }

  function clearState() {
    Object.keys(state).forEach(k => {
      if (Array.isArray(state[k])) state[k] = [];
      else if (typeof state[k] === 'number') state[k] = 0;
      else if (typeof state[k] === 'string') state[k] = '';
    });
    state.step = 1;
    state.audience_type = 'tiered';
    state.version = '1.0.0';
    localStorage.removeItem(STORAGE_KEY);
  }

  // === レンダリング・条項テンプレ展開 ===
  function renderClauseBlock(clause, scale, audienceType) {
    const isShort = (scale === 'S' || scale === 'XS' || audienceType === 'all');
    const text = isShort ? clause.clause_text_short : (clause.clause_text_full || clause.clause_text_short);
    let html = `<div class="clause-block" id="${clause.id}">`;
    html += `<h4>${clause.title} <span class="clause-id">${clause.id}</span>`;
    if (clause.necessity === 'required') html += ` <span class="badge required">必須</span>`;
    if (clause.lawyer_review_required) html += ` <span class="badge lawyer">弁護士確認推奨</span>`;
    html += `</h4>`;
    html += `<p class="clause-text">${escapeHtml(text)}</p>`;
    if (clause.explanation_beginner) {
      html += `<div class="explanation-beginner"><strong>📖 やさしい解説：</strong>${escapeHtml(clause.explanation_beginner)}</div>`;
    }
    if (clause.law_basis) {
      html += `<div class="law-basis"><strong>根拠：</strong>${escapeHtml(clause.law_basis)}</div>`;
    }
    if (clause.violation_risk_detail) {
      html += `<div class="violation-risk"><strong>違反時：</strong>${escapeHtml(clause.violation_risk_detail)}</div>`;
    }
    html += `</div>`;
    return html;
  }

  function renderClauseBlockMarkdown(clause, scale, audienceType) {
    const isShort = (scale === 'S' || scale === 'XS' || audienceType === 'all');
    const text = isShort ? clause.clause_text_short : (clause.clause_text_full || clause.clause_text_short);
    let md = `\n### ${clause.title}\n`;
    md += `\n*条項ID: ${clause.id}*`;
    if (clause.necessity === 'required') md += ` ／ **必須**`;
    if (clause.lawyer_review_required) md += ` ／ **弁護士確認推奨**`;
    md += `\n\n${text}\n`;
    if (clause.explanation_beginner) {
      md += `\n> **📖 やさしい解説：** ${clause.explanation_beginner}\n`;
    }
    if (clause.law_basis) {
      md += `\n**根拠：** ${clause.law_basis}\n`;
    }
    if (clause.violation_risk_detail) {
      md += `\n**違反時のリスク：** ${clause.violation_risk_detail}\n`;
    }
    return md;
  }

  // === 4成果物生成 ===
  function generateProduct01(data) {
    const tpl = TEMPLATES['01_guideline_base'];
    const scaleMeta = getScaleMeta(data.scale);
    const industryLabels = data.industries.map(i => getIndustryMeta(i)?.label).filter(Boolean).join('、');

    let md = '';
    md += `# ${tpl.title}\n## ${tpl.subtitle.replace('{company_name}', data.company_name)}\n\n`;
    md += TEMPLATES.common_header.preamble.replace('{法令時点}', data.creation_date || '2026年6月') + '\n\n';
    md += renderHeaderInfo(data, scaleMeta, industryLabels) + '\n\n';
    md += '---\n\n';

    const pruning = TEMPLATES.scale_specific_chapter_pruning[data.scale] || {};
    const includeSecIds = pruning.include_section_ids_01 || tpl.sections.map(s => s.id);

    tpl.sections.forEach(sec => {
      if (!includeSecIds.includes(sec.id)) return;
      md += `\n## ${sec.id}. ${sec.title}\n\n${sec.narrative}\n\n`;

      // 業種別条項処理
      let clauseIds = sec.include_clauses || [];
      if (sec.include_clauses_by_industry) {
        data.industries.forEach(ind => {
          if (sec.include_clauses_by_industry[ind]) {
            clauseIds = clauseIds.concat(sec.include_clauses_by_industry[ind]);
          }
        });
      }

      // 規模・業種フィルタ適用
      clauseIds.forEach(id => {
        const c = getClauseById(id);
        if (!c) return;
        if (!c.applies_to_scale.includes(data.scale)) return;
        const indMatch = c.applies_to_industry.includes('*') ||
          data.industries.some(i => c.applies_to_industry.includes(i));
        if (!indMatch) return;
        md += renderClauseBlockMarkdown(c, data.scale, data.audience_type);
      });
    });

    md += '\n' + TEMPLATES.footer_template
      .replace(/{version}/g, data.version)
      .replace(/{creation_date}/g, data.creation_date)
      .replace(/{creator}/g, data.contact_name || '—')
      .replace(/{security_officer}/g, data.contact_name || '—')
      .replace(/{ai_consultation_contact}/g, data.contact_email || '—')
      .replace(/{generator_version}/g, GENERATOR_VERSION);

    return md;
  }

  function generateProduct02(data) {
    const tpl = TEMPLATES['02_customization_guide'];
    const scaleMeta = getScaleMeta(data.scale);
    const industryLabels = data.industries.map(i => getIndustryMeta(i)?.label).filter(Boolean).join('、');

    let md = `# ${tpl.title}\n## ${tpl.subtitle.replace('{company_name}', data.company_name)}\n\n`;
    md += `> ${tpl.description}\n\n`;
    md += renderHeaderInfo(data, scaleMeta, industryLabels) + '\n\n---\n';

    tpl.sections.forEach(sec => {
      const narrative = sec.narrative
        .replace('{industries_label}', industryLabels)
        .replace('{scale_label}', scaleMeta?.label || data.scale);
      md += `\n## ${sec.id}. ${sec.title}\n\n${narrative}\n`;

      // 小規模（11-30名）規模帯の運用ヒント
      if (sec.id === '6' && data.scale === 'S2') {
        md += `\n> 💡 **小規模（11-30名）規模帯のヒント：**\n> 経営者の目が届きにくくなり始める規模帯です。一般的には、30分×3回の全社読み合わせ会と読了サインの組合せで「読まれたこと」「内容を理解したこと」を可視化する運用が効果的とされます。文書配布のみで終わらせず、口頭での補足機会を必ず設けることをお勧めします。\n`;
      }
    });

    md += '\n' + TEMPLATES.footer_template
      .replace(/{version}/g, data.version)
      .replace(/{creation_date}/g, data.creation_date)
      .replace(/{creator}/g, data.contact_name || '—')
      .replace(/{security_officer}/g, data.contact_name || '—')
      .replace(/{ai_consultation_contact}/g, data.contact_email || '—')
      .replace(/{generator_version}/g, GENERATOR_VERSION);

    return md;
  }

  function generateProduct03(data) {
    const tpl = TEMPLATES['03_risk_handbook'];
    const scaleMeta = getScaleMeta(data.scale);
    const industryLabels = data.industries.map(i => getIndustryMeta(i)?.label).filter(Boolean).join('、');

    let md = `# ${tpl.title}\n## ${tpl.subtitle.replace('{company_name}', data.company_name)}\n\n`;
    md += `> ${tpl.description}\n\n`;
    md += renderHeaderInfo(data, scaleMeta, industryLabels) + '\n\n---\n';

    tpl.sections.forEach(sec => {
      md += `\n## ${sec.id}. ${sec.title}\n\n${sec.narrative}\n`;
    });

    // 3大リスクの具体的記述を追加
    md += `\n\n## 詳細：3大リスクの具体的内容\n\n`;
    md += `### ① 情報漏洩リスク\n\n`;
    md += `- 個人情報のプロンプト投入による意図せぬ第三者提供\n- 営業秘密の生成AI投入による秘密管理性喪失\n- AIサービスの学習データへの取込\n- 委託先経由の二次漏洩\n- 退職者によるアカウント残留経由の持出\n\n`;
    md += `### ② 品質リスク\n\n`;
    md += `- ハルシネーション（AIが自信満々で間違った情報を出力）\n- バイアス（学習データに含まれる偏った情報の再生産）\n- 誤訳・誤要約\n- 古い情報の再生産\n- 第三者著作物の混入\n\n`;
    md += `### ③ 法令遵守リスク\n\n`;
    md += `- 個人情報保護法違反（第17条・第27条・第28条）\n- 著作権侵害（依拠性＋類似性で侵害判定）\n- 不正競争防止法上の営業秘密該当性喪失\n- 業界規制違反（医療：3省2ガイドライン／金融：FISC／教育：文科省GL等）\n- 景品表示法違反（AI生成広告コピーの優良誤認）\n\n`;

    md += '\n' + TEMPLATES.footer_template
      .replace(/{version}/g, data.version)
      .replace(/{creation_date}/g, data.creation_date)
      .replace(/{creator}/g, data.contact_name || '—')
      .replace(/{security_officer}/g, data.contact_name || '—')
      .replace(/{ai_consultation_contact}/g, data.contact_email || '—')
      .replace(/{generator_version}/g, GENERATOR_VERSION);

    return md;
  }

  function generateProduct04(data) {
    const tpl = TEMPLATES['04_masking_manual'];
    const scaleMeta = getScaleMeta(data.scale);
    const industryLabels = data.industries.map(i => getIndustryMeta(i)?.label).filter(Boolean).join('、');

    let md = `# ${tpl.title}\n## ${tpl.subtitle.replace('{company_name}', data.company_name)}\n\n`;
    md += `> ${tpl.description}\n\n`;
    md += renderHeaderInfo(data, scaleMeta, industryLabels) + '\n\n---\n';

    md += `\n## 📖 このマニュアルの使い方\n\n`;
    md += `本マニュアルは、現場でAIを使う方が「マスキング（情報の隠し方）」を3分で理解し、すぐ業務に応用できるように作られています。\n\n`;
    md += `**読み方の順番（おすすめ）：**\n1. 第1章「なぜマスキングが必要か」を読む（3分）\n2. 第10章「チートシート」を印刷して机に貼る\n3. 困った時に第9章「Q&A 30問」を辞書のように使う\n\n`;

    tpl.sections.forEach(sec => {
      md += `\n## ${sec.id}. ${sec.title}\n\n${sec.narrative}\n`;

      // セクション固有の詳細を追加
      if (sec.id === '4') {
        md += `\n### マスキングパターン10本\n\n`;
        md += `| # | マスク前 | マスク後 | 注意点 |\n|---|---|---|---|\n`;
        md += `| 1 | 田中太郎 | A様 | 性別がわからない場合は「氏名_A」も可 |\n`;
        md += `| 2 | 東京都港区六本木1-2-3 | ○○県○○市 | 番地まで残すと特定可能 |\n`;
        md += `| 3 | 090-1234-5678 | 09X-XXXX-XXXX | 末尾4桁残すのもNG |\n`;
        md += `| 4 | tanaka@example.co.jp | xxx@example.co.jp | ドメインだけでも会社特定可能 |\n`;
        md += `| 5 | 株式会社○○商事（売上25億円） | A社（売上規模B） | 売上額は範囲表記（10-50億）に |\n`;
        md += `| 6 | 2026/3/14 14:30 | YYYY/MM/DD HH:MM | 日時の特定情報 |\n`;
        md += `| 7 | 山田次郎（営業部長・45歳） | C氏（役職D・年代E） | 役職＋年齢で人物特定可能 |\n`;
        md += `| 8 | 受注金額¥3,456,789 | 受注金額（数百万円規模） | 端数の特定値は避ける |\n`;
        md += `| 9 | プロジェクト「○○改革」 | プロジェクト「F」 | プロジェクト名から会社特定 |\n`;
        md += `| 10 | 「うちの主力商品○○シリーズ」 | 「主力商品Gシリーズ」 | 商品名で会社特定 |\n`;
      }

      if (sec.id === '5') {
        md += `\n### シーン1：議事録要約\n\n`;
        md += `**Before（NG）：**\n\`\`\`\n2026年6月29日の○○商事との打合せ議事録を要約して：\n田中部長から「今期の発注を3,000万円に増やす」との発言あり。\n弊社・山田から「納期4月までに対応」と回答。\n\`\`\`\n\n`;
        md += `**After（OK）：**\n\`\`\`\nB社との打合せ議事録を要約して：\nB社の役職Aから「発注額を○倍に拡大」との発言あり。\n弊社担当から「指定納期での対応」を回答。\n\`\`\`\n\n`;
        md += `**復元時：** AIの要約が出たら、伏字を実名に戻して最終文書化。\n\n`;
        md += `（他3シーン：提案書ドラフト／顧客分析／メール返信は同様パターンで実演。詳細は別途完全版マニュアル参照）\n`;
      }

      if (sec.id === '8') {
        md += `\n### やっちゃダメな失敗例10集\n\n`;
        md += `1. **名前だけ隠して住所を残す**：「Aさん（東京都港区六本木1-2-3）」→ 住所で個人特定可能\n`;
        md += `2. **会社名隠して業界＋規模を残す**：「○○社（飲食業・売上25億）」→ 業界×規模で特定可能\n`;
        md += `3. **役職＋年齢を残す**：「C氏（営業部長・45歳）」→ 中小企業ではほぼ特定可能\n`;
        md += `4. **末尾4桁の電話番号を残す**：「090-XXXX-5678」→ 一部分でも個人特定の手がかり\n`;
        md += `5. **マスク後の文脈で特定**：「日本最古の○○メーカー」→ 検索一発で特定\n`;
        md += `6. **数値の端数を残す**：「売上¥3,456,789」→ 公開財務情報と照合で特定\n`;
        md += `7. **日付を残す**：「2026年3月14日の打合せ」→ 場所＋日時で参加者特定\n`;
        md += `8. **プロジェクトコード名を残す**：「Project Y」→ 業界内で周知のコード名は要伏字\n`;
        md += `9. **AIに「これマスキングできてる？」と聞かない**：AIは「できてます」と答えがち。人が判断\n`;
        md += `10. **復元忘れ**：マスク済みのまま社内文書として保存→他の人が読めない\n`;
      }
    });

    md += '\n' + TEMPLATES.footer_template
      .replace(/{version}/g, data.version)
      .replace(/{creation_date}/g, data.creation_date)
      .replace(/{creator}/g, data.contact_name || '—')
      .replace(/{security_officer}/g, data.contact_name || '—')
      .replace(/{ai_consultation_contact}/g, data.contact_email || '—')
      .replace(/{generator_version}/g, GENERATOR_VERSION);

    return md;
  }

  function renderHeaderInfo(data, scaleMeta, industryLabels) {
    return `**会社名**：${data.company_name || '（未入力）'}  \n` +
      `**業種**：${industryLabels || '（未選択）'}  \n` +
      `**従業員規模**：${data.employee_count}名（規模区分：${data.scale} ─ ${scaleMeta?.label || ''}）  \n` +
      `**作成日**：${data.creation_date || '（未設定）'}  \n` +
      `**次回見直し予定**：${data.creation_date ? addOneYear(data.creation_date) : '（作成日から1年後）'}  \n` +
      `**ガイドライン版**：v${data.version}`;
  }

  function addOneYear(dateStr) {
    const m = dateStr.match(/(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
    if (!m) return '';
    const y = parseInt(m[1]) + 1;
    return `${y}年${m[2]}月${m[3]}日`;
  }

  // === 専門家向け 要件定義書（本格制作版 相談用）生成 ===
  function generateRequirementsMD(data) {
    const scaleMeta = getScaleMeta(data.scale);
    const industryLabels = data.industries.map(i => getIndustryMeta(i)?.label).filter(Boolean).join('、');
    const recommended = recommendClauses(data.scale, data.industries);

    return `# 専門家向け 要件定義書 ─ AI・IT利用ガイドライン本格制作版 相談用

> このファイルは「AI・IT利用ガイドライン ジェネレーター v${GENERATOR_VERSION}」での入力内容をまとめたものです。
> 業種・社内事情にあわせた完全カスタマイズ版（弁護士確認・社内浸透支援込み）の制作をご相談の際は、本ファイルを弊社（uemura@artsoul.jp）までお送りください。

---

## 1. 貴社基本情報

| 項目 | 値 |
|---|---|
| 会社名 | ${data.company_name || '（未入力）'} |
| 自社業種記述 | ${data.industry_self || '—'} |
| 選択業種 | ${industryLabels} |
| 業種カテゴリID | ${data.industries.join(', ')} |
| 従業員数 | ${data.employee_count}名 |
| 規模区分 | **${data.scale}（${scaleMeta?.label || ''}）** |
| 担当者 | ${data.contact_name || '—'} |
| 連絡先 | ${data.contact_email || '—'} |
| 想定読者層 | ${data.audience_type} |
| 作成日 | ${data.creation_date} |

## 2. 規模特性（${data.scale}）

- **運用前提**：${scaleMeta?.ops_premise || '—'}
- **ガイドライン厚み**：${scaleMeta?.guideline_pages || '—'}
- **必須条項数**：${scaleMeta?.required_clauses_min}〜${scaleMeta?.required_clauses_max}条
- **認証視野**：${scaleMeta?.auth_target || '—'}
- **キーリスク**：${scaleMeta?.key_risk || '—'}
- **運用上の留意点**：${scaleMeta?.scale_ops_hint || '—'}

## 3. AI利用実態

| 項目 | 内容 |
|---|---|
| 利用ツール | ${data.ai_tools.join('、') || '—'} |
| 主な用途 | ${data.ai_purposes.join('、') || '—'} |
| 取扱データ種別 | ${data.data_types.join('、') || '—'} |
| マスキング必要場面 | ${data.masking_scenes || '—'} |

## 4. 既存規程

${data.existing_rules.length > 0 ?
  data.existing_rules.map(r => `- ${r.name}：${r.exists ? '✅ 有' : '❌ 無'}${r.note ? ' / ' + r.note : ''}`).join('\n')
  : '（既存規程情報未入力）'}

## 5. 採用条項リスト

**全${recommended.length}件 を推奨採用**

${recommended.map(id => {
  const c = getClauseById(id);
  return c ? `- \`${id}\` ${c.title}（${c.necessity}）` : '';
}).filter(Boolean).join('\n')}

## 6. 業種特化ガイドライン参照

${data.industries.map(ind => {
  const m = getIndustryMeta(ind);
  return m ? `- **${m.label}**：${m.key_laws.join('、')} ／ ${m.extra_warning}` : '';
}).filter(Boolean).join('\n')}

## 7. 出力希望形式

${data.output_formats.length > 0 ? data.output_formats.map(f => `- ${f}`).join('\n') : '- 未選択'}

---

## 弊社へのご相談事項

本要件定義書をお送りいただいた場合、弊社では以下の本格制作をお請けします：

1. **4成果物の完全カスタマイズ版 制作**
   - ① AI・IT利用ガイドライン本体（${scaleMeta?.guideline_pages}）
   - ② 自社カスタマイズ運用ガイドブック
   - ③ 生成AIリスク対策ハンドブック
   - ④ 機密情報マスキング 実務マニュアル

2. **業種・社内事情にあわせた条項カスタマイズ**
   - ${industryLabels} 業界の固有事情の反映
   - 既存社内規程との整合性確認
   - 業界用語の社内用語への置換

3. **規模 ${data.scale}（${scaleMeta?.label || ''}）の運用前提反映**
   - 規模に応じた読ませ方設計
   - 3ヶ月定着ロードマップの個別設計
   - キーマン特定と浸透施策の設計

4. **弁護士・社労士による最終確認の手配（オプション）**
   - 規模S/XS：スポット相談（3〜5万円程度／別途）
   - 規模S2/M：レビュー（10〜20万円程度／別途）
   - 規模L：業界専門弁護士による本格レビュー（別途お見積り）

5. **3ヶ月の社内浸透支援（オプション）**
   - 読み合わせ会のファシリテーション
   - 違反対応シミュレーション研修
   - 改訂サイクルの設計と運用

---

**お問い合わせ先：** 有限会社アートソウル  uemura@artsoul.jp

_生成日：${data.creation_date}_
_ジェネレーター版：v${GENERATOR_VERSION}_
_条項DB版：${CLAUSES ? 'v1.0.0' : '不明'}_

<!-- AIGL_REQUIREMENTS_META: ${JSON.stringify({v: 1, generator: GENERATOR_VERSION, state: state})} -->
`;
  }

  // === Markdown→HTML変換（軽量版） ===
  function mdToHtml(md) {
    let html = md;
    // 表
    html = html.replace(/(\|.+\|\n\|[-:\s|]+\|\n(?:\|.+\|\n)+)/g, function(match) {
      const lines = match.trim().split('\n');
      const headers = lines[0].split('|').map(c => c.trim()).filter(c => c);
      const rows = lines.slice(2).map(line => line.split('|').map(c => c.trim()).filter(c => c));
      let table = '<table><thead><tr>' + headers.map(h => `<th>${h}</th>`).join('') + '</tr></thead><tbody>';
      rows.forEach(r => {
        table += '<tr>' + r.map(c => `<td>${c}</td>`).join('') + '</tr>';
      });
      table += '</tbody></table>';
      return table;
    });
    // 見出し
    html = html.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
    // 引用
    html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');
    html = html.replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>');
    // 強調
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    // インラインコード
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    // 段落
    html = html.split('\n\n').map(p => {
      if (p.startsWith('<') || p.trim() === '') return p;
      return `<p>${p.replace(/\n/g, '<br>')}</p>`;
    }).join('\n');
    return html;
  }

  // === HTML出力フル ===
  function generateFullHtml(data, allProductsMd) {
    const date = data.creation_date || new Date().toISOString().slice(0, 10);
    return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<title>${data.company_name} ─ AI・IT利用ガイドライン一式</title>
<style>
body { font-family: "Yu Gothic", "Hiragino Sans", "Noto Sans JP", sans-serif; max-width: 880px; margin: 0 auto; padding: 32px; line-height: 1.85; color: #1F2E2A; background: #FAFAF7; }
h1 { font-family: "Yu Mincho", serif; color: #2D5A4E; border-bottom: 3px solid #2D5A4E; padding-bottom: 10px; margin: 40px 0 20px; }
h2 { color: #2D5A4E; border-left: 4px solid #C89E5E; padding-left: 14px; margin: 32px 0 16px; }
h3 { color: #1E3F36; margin: 24px 0 12px; }
h4 { color: #2D5A4E; margin: 18px 0 10px; }
table { width: 100%; border-collapse: collapse; margin: 16px 0; background: #fff; }
th { background: #2D5A4E; color: #fff; padding: 10px; text-align: left; }
td { padding: 10px; border-bottom: 1px solid #D8D2C4; }
.clause-block { background: #fff; border: 1px solid #D8D2C4; padding: 16px 20px; margin: 14px 0; border-radius: 6px; }
.clause-id { font-family: monospace; font-size: 12px; color: #8A9994; }
.badge.required { background: #C89E5E; color: #fff; padding: 2px 10px; font-size: 11px; border-radius: 3px; }
.badge.lawyer { background: #B85850; color: #fff; padding: 2px 10px; font-size: 11px; border-radius: 3px; }
.explanation-beginner { background: #F1EFE8; padding: 10px 14px; border-radius: 4px; margin: 8px 0; font-size: 14px; }
.law-basis { font-size: 13px; color: #4F5E5A; margin-top: 6px; }
.violation-risk { font-size: 13px; color: #B85850; margin-top: 4px; }
blockquote { background: #F1EFE8; border-left: 4px solid #C89E5E; padding: 12px 18px; margin: 14px 0; font-size: 14px; }
code { background: #F1EFE8; padding: 2px 6px; border-radius: 3px; font-family: monospace; font-size: 13px; }
.product-divider { page-break-before: always; border: none; border-top: 3px double #2D5A4E; margin: 60px 0 40px; }
@media print { body { background: #fff; max-width: 100%; padding: 20px; } }
</style>
</head>
<body>
${mdToHtml(allProductsMd)}
</body>
</html>`;
  }

  // === エスケープ ===
  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // === ファイルダウンロード ===
  function downloadBlob(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // === 出力エンジン公開API ===
  async function exportHtml(data, allProductsMd) {
    const html = generateFullHtml(data, allProductsMd);
    downloadBlob(html, `${data.company_name || 'AIガイドライン'}_${data.creation_date}.html`, 'text/html;charset=utf-8');
  }

  async function exportWord(data, allProductsMd) {
    if (typeof htmlDocx === 'undefined') {
      alert('Word出力ライブラリ（html-docx-js）が読み込まれていません。');
      return;
    }
    const html = generateFullHtml(data, allProductsMd);
    const blob = htmlDocx.asBlob(html);
    downloadBlob(blob, `${data.company_name || 'AIガイドライン'}_${data.creation_date}.docx`, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  }

  async function exportPdf(data, allProductsMd) {
    if (typeof html2pdf === 'undefined') {
      alert('PDF出力ライブラリ（html2pdf.js）が読み込まれていません。');
      return;
    }
    const html = generateFullHtml(data, allProductsMd);
    const container = document.createElement('div');
    container.innerHTML = html;
    container.style.position = 'absolute';
    container.style.left = '-9999px';
    document.body.appendChild(container);
    const opt = {
      margin: [15, 15, 20, 15],
      filename: `${data.company_name || 'AIガイドライン'}_${data.creation_date}.pdf`,
      image: { type: 'jpeg', quality: 0.95 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      pagebreak: { mode: ['css', 'legacy'] }
    };
    try {
      await html2pdf().set(opt).from(container).save();
    } finally {
      container.remove();
    }
  }

  async function exportMd(data, allProductsMd) {
    const wrapper = `# ${data.company_name} ─ AIガイドライン一式\n\n_生成日：${data.creation_date}_  \n_ジェネレーター版：v${GENERATOR_VERSION}_\n\n---\n\n${allProductsMd}\n\n<!-- AIGL_STATE: ${JSON.stringify({v: 1, state: state})} -->`;
    downloadBlob(wrapper, `${data.company_name || 'AIガイドライン'}_${data.creation_date}.md`, 'text/markdown;charset=utf-8');
  }

  async function exportRequirements(data) {
    const md = generateRequirementsMD(data);
    downloadBlob(md, `${data.company_name || '貴社'}_要件定義書_本格制作版相談用_${data.creation_date}.md`, 'text/markdown;charset=utf-8');
  }

  // === メイン生成エントリ ===
  async function generateAll() {
    if (!validateRequired()) return;
    if (!data().creation_date) state.creation_date = new Date().toISOString().slice(0, 10);

    const d = data();
    showLoading('成果物を生成中...');

    try {
      const p1 = generateProduct01(d);
      const p2 = generateProduct02(d);
      const p3 = generateProduct03(d);
      const p4 = generateProduct04(d);

      const allMd =
        p1 + '\n\n<hr class="product-divider">\n\n' +
        p2 + '\n\n<hr class="product-divider">\n\n' +
        p3 + '\n\n<hr class="product-divider">\n\n' +
        p4;

      const formats = d.output_formats;
      for (const fmt of formats) {
        if (fmt === 'html') await exportHtml(d, allMd);
        else if (fmt === 'word') await exportWord(d, allMd);
        else if (fmt === 'pdf') await exportPdf(d, allMd);
        else if (fmt === 'md') await exportMd(d, allMd);
        else if (fmt === 'requirements') await exportRequirements(d);
        await new Promise(r => setTimeout(r, 300));
      }

      hideLoading();
      showToast('✅ 生成完了。ダウンロードフォルダを確認してください。', 'good');
    } catch (e) {
      hideLoading();
      console.error(e);
      showToast('⚠️ 生成中にエラー：' + e.message, 'bad');
    }
  }

  function validateRequired() {
    if (!state.company_name) { showToast('会社名を入力してください', 'bad'); return false; }
    if (!state.employee_count || state.employee_count < 1) { showToast('従業員数を入力してください', 'bad'); return false; }
    if (state.industries.length === 0) { showToast('業種を1つ以上選択してください', 'bad'); return false; }
    if (state.output_formats.length === 0) { showToast('出力形式を1つ以上選択してください', 'bad'); return false; }
    return true;
  }

  function showLoading(msg) {
    let ov = document.querySelector('.loading-overlay');
    if (!ov) {
      ov = document.createElement('div');
      ov.className = 'loading-overlay';
      ov.innerHTML = '<div class="spinner"></div><div class="msg"></div>';
      document.body.appendChild(ov);
    }
    ov.querySelector('.msg').textContent = msg;
    ov.classList.add('visible');
  }
  function hideLoading() {
    const ov = document.querySelector('.loading-overlay');
    if (ov) ov.classList.remove('visible');
  }
  function showToast(msg, kind) {
    const t = document.createElement('div');
    const bg = kind === 'bad' ? '#B85850' : (kind === 'good' ? '#2D5A4E' : '#1F2E2A');
    t.style.cssText = `position:fixed;bottom:90px;left:50%;transform:translateX(-50%);z-index:1001;background:${bg};color:#fff;padding:14px 24px;border-radius:8px;font-family:sans-serif;font-size:14px;box-shadow:0 8px 24px rgba(0,0,0,.3);max-width:560px;line-height:1.6;`;
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => { t.style.transition = 'opacity .3s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 4000);
  }

  function data() {
    return state;
  }

  // === Public API ===
  global.AIGL = {
    state: state,
    loadDB: loadDB,
    calculateScale: calculateScale,
    getScaleMeta: getScaleMeta,
    getIndustryMeta: getIndustryMeta,
    recommendClauses: recommendClauses,
    classifyClauses: classifyClauses,
    saveState: saveState,
    loadState: loadState,
    clearState: clearState,
    generateAll: generateAll,
    generateRequirementsMD: generateRequirementsMD,
    META: () => META,
    CLAUSES: () => CLAUSES,
    GLOSSARY: () => GLOSSARY,
    showToast: showToast,
    GENERATOR_VERSION: GENERATOR_VERSION
  };

})(window);
