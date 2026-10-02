// 求人票の機械点検。ブラウザ（無料チェックのページ）と Python（engine/jscore.py）の両方がこのファイルを使う。
// 根拠：職業安定法施行規則（2024年4月改正の明示事項）、男女雇用機会均等法、労働施策総合推進法（年齢）、
// 最低賃金法、若者雇用促進法の指針（固定残業代）。法的な判断ではなく、書き方の点検。
var KyujinCheck = (function () {
  'use strict';

  var VERSION = '2026-10-02.v1';

  function norm(t) {
    return String(t || '')
      .replace(/\r\n?/g, '\n')
      .replace(/[０-９]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0xFEE0); })
      .replace(/[，]/g, ',')
      .replace(/[：]/g, ':')
      .replace(/[（]/g, '(').replace(/[）]/g, ')')
      .replace(/[～~〜]/g, '〜');
  }

  function num(s) { return parseFloat(String(s).replace(/,/g, '')); }

  function yen(n) { return String(Math.round(n)).replace(/(\d)(?=(\d{3})+$)/g, '$1,'); }

  function jdate(d) { return d.replace(/^(\d+)-0?(\d+)-0?(\d+)$/, '$1年$2月$3日'); }

  function excerpt(t, i, len) {
    var a = Math.max(0, i - 10), b = Math.min(t.length, i + len + 10);
    return (a > 0 ? '…' : '') + t.slice(a, b).replace(/\n/g, ' ') + (b < t.length ? '…' : '');
  }

  function lineAt(t, i) {
    var a = t.lastIndexOf('\n', i - 1) + 1, b = t.indexOf('\n', i);
    return t.slice(a, b < 0 ? t.length : b);
  }

  function findAll(t, re) {
    var out = [], m, g = new RegExp(re.source, re.flags.indexOf('g') < 0 ? re.flags + 'g' : re.flags);
    while ((m = g.exec(t)) !== null) {
      out.push({text: m[0], index: m.index, m: m});
      if (m[0].length === 0) g.lastIndex++;
    }
    return out;
  }

  // ---------- 都道府県 ----------
  var CITY = {
    '札幌市': '北海道', '仙台市': '宮城県', 'さいたま市': '埼玉県', '千葉市': '千葉県', '横浜市': '神奈川県',
    '川崎市': '神奈川県', '相模原市': '神奈川県', '新潟市': '新潟県', '静岡市': '静岡県', '浜松市': '静岡県',
    '名古屋市': '愛知県', '京都市': '京都府', '大阪市': '大阪府', '堺市': '大阪府', '神戸市': '兵庫県',
    '岡山市': '岡山県', '広島市': '広島県', '北九州市': '福岡県', '福岡市': '福岡県', '熊本市': '熊本県'
  };
  var WARDS = ('千代田 中央 港 新宿 文京 台東 墨田 江東 品川 目黒 大田 世田谷 渋谷 中野 杉並 豊島 北 荒川 板橋 練馬 足立 葛飾 江戸川').split(' ');

  function detectPrefs(t) {
    var found = {}, list = (typeof KyujinMinWage !== 'undefined') ? KyujinMinWage.prefs() : [];
    // 「東京都」の中の「京都」を拾わないよう、長い名前から順に消しながら探す
    var rest = t;
    list.slice().sort(function (a, b) { return b.length - a.length; }).forEach(function (p) {
      if (rest.indexOf(p) >= 0) { found[p] = true; rest = rest.split(p).join('□'); }
    });
    Object.keys(CITY).forEach(function (c) { if (rest.indexOf(c) >= 0) found[CITY[c]] = true; });
    WARDS.forEach(function (w) {
      var re = new RegExp('(^|[^一-龥])' + w + '区');
      if (re.test(rest)) found['東京都'] = true;
    });
    return Object.keys(found);
  }

  // ---------- 1. 性別 ----------
  var BOTH = /^.{0,6}(\(男女\)|男女不問|男女問わず)/;
  var FACT = /^.{0,10}(活躍|在籍|働いて|が多|の多い)/;
  var GENDER = [
    {re: /(女性|男性)(限定|のみ|に限る|歓迎|募集|スタッフ募集|の方を募集|の方募集|優遇|希望|向けの(お)?仕事)/, fix: '「男女問わず」とし、仕事内容（重い物を持つ等）を具体的に書く'},
    {re: /(女子|男子)(スタッフ|社員|募集|歓迎)/, fix: '「スタッフ」「社員」など性別を含まない言葉にする'},
    {re: /(男性|女性)\s*[0-9一二三四五六七八九十]+\s*名/, fix: '男女別の人数枠は書かない（「○名募集」とまとめる）', skipFact: true},
    {re: /主婦(?![・\/]?主夫|\(夫\)|\(主夫\))/, fix: '「主婦・主夫歓迎」と両方を書く', skipFact: true},
    {re: /(営業マン|セールスマン|ビジネスマン|ガードマン|ウェイトレス|ウエイトレス|看護婦|保母|スチュワーデス|家政婦|(?<![A-Za-z])OL(?![A-Za-z]))/,
      fix: '性別を含まない職種名にする（営業マン→営業職、ウェイトレス→ホールスタッフ、看護婦→看護師）', allowAfter: BOTH,
      allowBefore: /(ウェイター|ウエイター)[・\/]?$/},
    {re: /(ウェイター|ウエイター)(?![・\/]?(ウェイトレス|ウエイトレス))/, fix: '「ホールスタッフ」にするか、「ウェイター・ウェイトレス」と併記する', allowAfter: BOTH}
  ];
  var GENDER_SOFT = /(女性|男性|主婦|主夫)(の方)?(が|も)?(活躍中|活躍しています|多数活躍|が多い|の多い|中心の|多数在籍)/;

  function checkGender(t, out) {
    GENDER.forEach(function (g) {
      findAll(t, g.re).forEach(function (h) {
        var rest = t.slice(h.index + h.text.length);
        if (g.allowAfter && g.allowAfter.test(rest)) return;
        if (g.allowBefore && g.allowBefore.test(t.slice(Math.max(0, h.index - 8), h.index))) return; // 「ウェイター・ウェイトレス」
        if (g.skipFact && FACT.test(rest)) return; // 「男性3名・女性2名が在籍」「主婦の方が活躍中」は下の弱い指摘で扱う
        out.push({level: 'law', id: 'gender', title: '性別を限定する書き方', hit: h.text,
          where: excerpt(t, h.index, h.text.length),
          detail: '男女雇用機会均等法により、募集で性別を限定・優先する表現は原則として使えません（警備・モデル・同性介助など一部の例外を除く）。',
          fix: g.fix});
      });
    });
    findAll(t, GENDER_SOFT).forEach(function (h) {
      out.push({level: 'hint', id: 'gender-soft', title: '性別の偏りを感じさせる表現', hit: h.text,
        where: excerpt(t, h.index, h.text.length),
        detail: '事実の紹介であれば違反ではありませんが、もう一方の性別の人が応募をためらう原因になります。',
        fix: '「20〜50代の男女が在籍」のように幅を見せるか、人数・雰囲気を具体的に書く'});
    });
  }

  // ---------- 2. 年齢 ----------
  function checkAge(t, out) {
    var law = function (h, fix) {
      out.push({level: 'law', id: 'age', title: '年齢を制限する書き方', hit: h.text, where: excerpt(t, h.index, h.text.length),
        detail: '労働施策総合推進法により、募集で年齢を制限することは原則として禁止です。例外（定年を上限とする、長期キャリア形成のための若年者の無期雇用など）に当たる場合は、例外の理由を求人票に書く必要があります。',
        fix: fix || '年齢の条件を外し、必要な経験・資格・体力面の条件を具体的に書く'});
    };
    var seen = {};
    var add = function (h, fix) { if (seen[h.index]) return; seen[h.index] = true; law(h, fix); };

    var soft = function (h) {
      out.push({level: 'hint', id: 'age-soft', title: '年代を絞った印象を与える表現', hit: h.text, where: excerpt(t, h.index, h.text.length),
        detail: '在籍者の紹介であれば違反ではありませんが、それ以外の年代の人が応募をためらう原因になります。',
        fix: '「20〜60代が在籍」のように幅を見せる'});
    };
    var isFact = function (h) { return FACT.test(t.slice(h.index + h.text.length)); };

    findAll(t, /([1-9][0-9])\s*歳?\s*(〜|-|ー|から)\s*([1-9][0-9])\s*歳/).forEach(function (h) {
      seen[h.index] = true;
      if (isFact(h)) soft(h); else law(h);
    });
    findAll(t, /([1-9][0-9])\s*歳\s*(まで|以下|未満|迄|位まで|くらいまで|程度まで|前後)/).forEach(function (h) {
      if (parseInt(h.m[1], 10) === 18) return; // 「18歳未満は不可」は労働基準法による例外
      if (/^.{0,10}(働け|勤務可|再雇用|雇用延長|継続雇用|活躍でき)/.test(t.slice(h.index + h.text.length))) return; // 「70歳まで働けます」
      if (/定年/.test(lineAt(t, h.index))) {
        out.push({level: 'hint', id: 'age-exception', title: '年齢の上限（定年の例外）', hit: h.text, where: excerpt(t, h.index, h.text.length),
          detail: '定年年齢を上限とする募集は例外として認められますが、「期間の定めのない雇用であること」と「定年が○歳であること」を理由として書く必要があります。',
          fix: '例：「59歳以下（定年が60歳のため・期間の定めのない雇用）」'});
        return;
      }
      add(h);
    });
    findAll(t, /([1-9][0-9])\s*歳\s*以上/).forEach(function (h) {
      var age = parseInt(h.m[1], 10);
      if (age === 18) return; // 労働基準法の年少者の制限による例外
      if (age >= 60) {
        out.push({level: 'hint', id: 'age-exception', title: '年齢の下限（60歳以上）', hit: h.text, where: excerpt(t, h.index, h.text.length),
          detail: '60歳以上に限る募集は例外として認められています。', fix: '問題ありません。理由（高年齢者の雇用促進）を添えると親切です'});
        return;
      }
      add(h, '年齢の下限を外す（法令上の理由がある場合はその理由を書く）');
    });
    var lastDecade = -10;
    findAll(t, /([1-9]0)\s*代/).forEach(function (h) {
      if (h.index - lastDecade < 8) return; // 「20代〜30代」の2つ目は数えない
      lastDecade = h.index;
      var after = t.slice(h.index, h.index + 24);
      if (/^[1-9]0\s*代\s*[0-9]+\s*(名|人)/.test(after)) return; // 「30代2名・40代3名」は顔ぶれの紹介
      if (/(活躍|在籍|働いて|が多|中心の職場|のスタッフが)/.test(after)) { soft(h); return; }
      if (/^([1-9]0)\s*代\s*(〜|-|から)?\s*([1-9]0\s*代)?\s*(の方|まで|前半|後半|を募集|歓迎|限定|向け|希望|中心に募集)/.test(after)) add(h);
    });
    findAll(t, /(若い|若年|ヤング)(方|人|人材|世代|スタッフ)?(を)?(歓迎|募集|限定|希望|求む)|若い(方|人|人材)/).forEach(function (h) { add(h, '「未経験歓迎」「長く働ける方歓迎」など、年齢ではなく経験・働き方の条件にする'); });
    findAll(t, /(シニア|中高年|高齢者)(不可|お断り|NG)/).forEach(function (h) { add(h); });
  }

  // ---------- 3. 最低賃金 ----------
  function checkWage(t, out, opt) {
    var prefs = opt.pref ? [opt.pref] : detectPrefs(t);
    var date = opt.date || new Date().toISOString().slice(0, 10);
    var hourly = [], taken = {};
    var push = function (h, g) {
      var at = h.index + h.text.indexOf(h.m[g]);
      if (taken[at]) return;
      taken[at] = true;
      hourly.push({v: num(h.m[g]), h: h});
    };
    findAll(t, /時給\s*(?:は)?\s*:?\s*[¥￥]?\s*([0-9][0-9,]{2,5})(?=\s*(円|〜|\D))/).forEach(function (h) { push(h, 1); });
    findAll(t, /([0-9][0-9,]{2,5})\s*円\s*\/\s*(時間|時|h)(?![a-z])/).forEach(function (h) { push(h, 1); });
    if (!hourly.length && !/月給/.test(t)) return;
    if (!prefs.length) {
      if (hourly.length) out.push({level: 'hint', id: 'wage-pref', title: '勤務地の都道府県が分かりません', hit: '', where: '',
        detail: '時給が最低賃金を満たしているかを確認するには、勤務地の都道府県が必要です。', fix: '勤務地に都道府県名を書く（このページでは上の欄で選べます）'});
      return;
    }
    if (typeof KyujinMinWage === 'undefined') return;
    var mws = prefs.map(function (p) { return KyujinMinWage.at(p, date); }).filter(Boolean);
    if (!mws.length) return;
    // 複数の勤務地があるときは、いちばん高い県で見る
    mws.sort(function (a, b) { return (b.next || b.current) - (a.next || a.current); });
    var mw = mws[0];
    hourly.forEach(function (x) {
      if (x.v < 500 || x.v > 10000) return;
      if (x.v < mw.current) {
        out.push({level: 'law', id: 'minwage', title: '最低賃金を下回っています', hit: x.h.text, where: excerpt(t, x.h.index, x.h.text.length),
          detail: mw.pref + 'の最低賃金は時給' + yen(mw.current) + '円です（' + KyujinMinWage.FISCAL + '）。研修期間中も最低賃金を下回ることはできません（減額の特例は労働局の許可が必要）。',
          fix: '時給を' + yen(mw.current) + '円以上にする'});
      } else if (mw.next && x.v < mw.next) {
        out.push({level: 'law', id: 'minwage-next', title: '発効日からの最低賃金に届いていません', hit: x.h.text, where: excerpt(t, x.h.index, x.h.text.length),
          detail: mw.pref + 'の最低賃金は ' + jdate(mw.nextDate) + ' から時給' + yen(mw.next) + '円に上がります。それ以降に働く分は、この時給では違反になります。',
          fix: '時給を' + yen(mw.next) + '円以上にする（掲載中の求人票も書き換える）'});
      }
    });
    // 月給は、年間休日と1日の労働時間が書いてあるときだけ時給に直して確かめる
    var mg = /月給\s*:?\s*([0-9][0-9,.]*)\s*(万)?\s*円/.exec(t), ho = /年間休日\s*:?\s*([0-9]{2,3})\s*日/.exec(t),
      hr = /(実働|1日)\s*([0-9](\.[0-9])?)\s*時間/.exec(t);
    if (mg && ho && hr && !/(固定残業|みなし残業|定額残業)/.test(t)) {
      var monthly = num(mg[1]) * (mg[2] ? 10000 : 1), days = 365 - parseInt(ho[1], 10), perDay = parseFloat(hr[2]);
      if (monthly > 50000 && days > 150 && perDay > 0) {
        var perHour = monthly * 12 / (days * perDay);
        if (perHour < (mw.next || mw.current)) {
          out.push({level: 'law', id: 'minwage-monthly', title: '月給を時給に直すと最低賃金を下回るおそれ', hit: mg[0], where: excerpt(t, mg.index, mg[0].length),
            detail: '月給' + yen(monthly) + '円 × 12か月 ÷（' + days + '日 × ' + perDay + '時間）= 時給 約' + yen(Math.floor(perHour)) + '円。' +
              mw.pref + 'の最低賃金は' + (mw.next ? jdate(mw.nextDate) + 'から' + yen(mw.next) : yen(mw.current)) + '円です。通勤手当・家族手当・皆勤手当などは計算に含められません。',
            fix: '基本給と、最低賃金に含められる手当の合計を見直す'});
        }
      }
    }
  }

  // ---------- 4. 固定残業代 ----------
  function checkFixedOvertime(t, out) {
    var h = /(固定残業|みなし残業|定額残業|固定時間外|みなし時間外)/.exec(t);
    if (!h) return;
    var miss = [];
    if (!/[0-9]+\s*時間分/.test(t)) miss.push('何時間分か');
    if (!/(固定残業|みなし残業|定額残業|固定時間外|みなし時間外)[^\n]{0,40}[0-9][0-9,]*\s*(円|万円)|[0-9][0-9,]*\s*(円|万円)[^\n]{0,20}(固定残業|みなし残業|定額残業)/.test(t)) miss.push('手当の金額');
    if (!/(超え|超過|超える)[^。\n]{0,30}(支給|支払)|追加(で)?支給|別途支給/.test(t)) miss.push('超えた分を追加で支払うこと');
    if (!/基本給/.test(t)) miss.push('固定残業代を除いた基本給');
    if (!miss.length) return;
    out.push({level: 'law', id: 'fixed-overtime', title: '固定残業代の書き方が足りません', hit: h[0], where: excerpt(t, h.index, h[0].length),
      detail: '固定残業代（みなし残業代）を払う場合は、(1) それを除いた基本給、(2) 何時間分でいくらか、(3) 超えた分は追加で支払うこと、の3点を書く必要があります。不足：' + miss.join('、') + '。',
      fix: '例：「基本給 22万円（固定残業代を除く）／固定残業手当 3万円（月20時間分）／20時間を超える残業代は追加で支給」'});
  }

  // ---------- 5. 明示が必要な項目（職業安定法施行規則） ----------
  var REQUIRED = [
    {id: 'duties', name: '業務内容', re: /(仕事内容|業務内容|職務内容|仕事の内容|お仕事内容)/, ex: '（雇入れ直後）ホール接客・レジ　（変更の範囲）店舗運営に関する業務全般'},
    {id: 'contract', name: '契約期間', re: /(契約期間|雇用期間|期間の定め|無期雇用|有期雇用|期間の定めなし|期間の定めあり)/, ex: '期間の定めなし（正社員の場合）／期間の定めあり（6か月）'},
    {id: 'trial', name: '試用期間', re: /(試用期間|試用|研修期間)/, ex: '試用期間あり（3か月・条件は本採用と同じ）／試用期間なし', soft: true},
    {id: 'place', name: '就業場所', re: /(勤務地|就業場所|勤務先|勤務場所|勤務する場所|働く場所)/, ex: '（雇入れ直後）○○店（変更の範囲）○○市内の当社店舗'},
    {id: 'hours', name: '就業時間', re: /(勤務時間|就業時間|始業|労働時間|シフト制|[0-9]{1,2}\s*:\s*[0-9]{2}\s*(〜|-|ー|から)\s*[0-9]{1,2}\s*:\s*[0-9]{2}|[0-9]{1,2}時\s*(〜|-|から)\s*[0-9]{1,2}時)/, ex: '9:00〜18:00'},
    {id: 'break', name: '休憩時間', re: /休憩/, ex: '休憩60分（12:00〜13:00）'},
    {id: 'holiday', name: '休日', re: /(休日|定休|週休|公休|休み)/, ex: '週休2日（シフト制）・年末年始'},
    {id: 'overtime', name: '時間外労働', re: /(残業|時間外)/, ex: '時間外労働あり（月平均10時間）／なし'},
    {id: 'wage', name: '賃金', re: /(給与|給料|賃金|時給|月給|日給|年俸|基本給)/, ex: '時給1,300円〜（試用期間中も同額）'},
    {id: 'insurance', name: '加入保険', re: /(社会保険|社保|雇用保険|労災|健康保険|厚生年金|各種保険)/, ex: '雇用保険・労災保険・健康保険・厚生年金（加入条件を満たす場合）'},
    {id: 'smoking', name: '受動喫煙を防ぐ措置', re: /(禁煙|喫煙|分煙)/, ex: '屋内禁煙（屋外に喫煙場所あり）'},
    {id: 'employer', name: '募集者の氏名または名称', re: /(株式会社|有限会社|合同会社|合資会社|医療法人|社会福祉法人|一般社団法人|NPO法人|会社名|事業所名|店舗名|店名|屋号|募集者|事業者名|運営会社)/, ex: '株式会社○○（店名：○○）'}
  ];

  function checkRequired(t, out) {
    REQUIRED.forEach(function (r) {
      if (r.re.test(t)) return;
      out.push({level: r.soft ? 'hint' : 'missing', id: 'req-' + r.id, title: r.name + 'が見当たりません', hit: '', where: '',
        detail: r.soft ? '試用期間がある場合は、期間と条件（賃金が変わるか等）の明示が必要です。ない場合も「なし」と書くと安心です。'
          : '求人票に必ず書く項目です（職業安定法施行規則）。別の言葉で書いてある場合は問題ありません。',
        fix: '記載例：' + r.ex});
    });
    // 2024年4月からの追加3項目
    var scope = findAll(t, /変更の範囲|変更範囲/).length;
    if (scope === 0) {
      out.push({level: 'missing', id: 'req-scope', title: '「変更の範囲」が書かれていません（2024年4月からの義務）', hit: '', where: '',
        detail: '業務内容と就業場所のそれぞれについて、入社直後だけでなく、将来の配置転換などで変わりうる範囲を書く必要があります。変わらない場合は「変更なし」と書きます。',
        fix: '例：「業務内容（雇入れ直後）調理補助（変更の範囲）店舗業務全般」「就業場所（雇入れ直後）本店（変更の範囲）変更なし」'});
    } else if (scope === 1) {
      out.push({level: 'missing', id: 'req-scope-one', title: '「変更の範囲」が片方だけかもしれません', hit: '', where: '',
        detail: '「変更の範囲」は業務内容と就業場所の両方に必要です。', fix: '業務内容・就業場所の両方に（変更の範囲）を書く'});
    }
    var fixedTerm = /(期間の定めあり|有期|契約社員|契約期間\s*:?\s*[0-9]+\s*(か月|ヶ月|カ月|ケ月|年))/.test(t);
    if (fixedTerm && !/(更新)/.test(t)) {
      out.push({level: 'missing', id: 'req-renew', title: '契約更新の有無と判断の基準が見当たりません', hit: '', where: '',
        detail: '期間の定めのある契約では、更新の有無と、更新するかどうかの判断基準を書く必要があります。',
        fix: '例：「契約の更新 有（勤務成績・業務量により判断）」'});
    }
    if (fixedTerm && /更新/.test(t) && !/(上限|更新回数|通算)/.test(t)) {
      out.push({level: 'missing', id: 'req-renew-cap', title: '更新の上限の有無が見当たりません（2024年4月からの義務）', hit: '', where: '',
        detail: '通算契約期間や更新回数に上限がある場合は、その内容を書く必要があります。上限がない場合も「上限なし」と書くと誤解がありません。',
        fix: '例：「更新上限 有（通算契約期間は4年まで）」／「更新上限 なし」'});
    }
  }

  // ---------- 6. 応募を増やすための見直し ----------
  var CLICHE = ['アットホーム', 'やる気のある', 'やる気がある', '元気な方', '明るい職場', '頑張り次第', '誰でもできる', '簡単なお仕事', '簡単な作業', '楽しい職場', '風通しの良い', '風通しのよい', '笑顔が絶えない', '家族のような'];

  function checkAppeal(t, out) {
    CLICHE.forEach(function (w) {
      var i = t.indexOf(w);
      if (i < 0) return;
      out.push({level: 'hint', id: 'cliche', title: '決まり文句「' + w + '」', hit: w, where: excerpt(t, i, w.length),
        detail: 'どの求人にも書かれている言葉で、読み手の判断材料になりません。',
        fix: '事実に置き換える（例：「スタッフ5名・30〜50代・昼休みは交代で全員そろって取ります」）'});
    });
    if (!/(1日の流れ|一日の流れ|1日のスケジュール|一日のスケジュール|スケジュール例|ある日の)/.test(t)) {
      out.push({level: 'hint', id: 'day-flow', title: '1日の流れがありません', hit: '', where: '',
        detail: '働く姿を想像できる求人ほど応募の判断がしやすくなります。',
        fix: '例：「9:00 開店準備 → 10:00 接客 → 12:00 交代で休憩 → 18:00 締め作業」'});
    }
    if (!/([0-9]+\s*(名|人)\s*(在籍|のスタッフ|の職場|体制|で運営|が働)|スタッフ数|従業員数|社員数|[0-9]+\s*名\s*\()/.test(t)) {
      out.push({level: 'hint', id: 'staff', title: '一緒に働く人数・顔ぶれがありません', hit: '', where: '',
        detail: '小さな職場ほど「どんな人と働くか」が応募の決め手になります。', fix: '例：「スタッフ6名（30代2名・40代3名・60代1名）」'});
    }
    var r = /(月給|時給)\s*:?\s*([0-9][0-9,.]*)\s*(万)?\s*円?\s*〜\s*([0-9][0-9,.]*)\s*(万)?\s*円/.exec(t);
    if (r) {
      var lo = num(r[2]) * (r[3] ? 10000 : 1), hi = num(r[4]) * (r[5] ? 10000 : (r[3] && num(r[4]) < 1000 ? 10000 : 1));
      if (lo > 0 && hi / lo >= (r[1] === '月給' ? 1.6 : 1.4)) {
        out.push({level: 'hint', id: 'wage-range', title: '給与の幅が広すぎます', hit: r[0], where: excerpt(t, r.index, r[0].length),
          detail: '幅が広いと、自分がいくらもらえるのか想像できず、応募をためらう原因になります。', fix: '「入社時の目安：未経験 月給22万円／経験3年 月給26万円」のように例を添える'});
      }
    }
    if (/未経験/.test(t) && !/(研修|教育|OJT|マニュアル|先輩(が|と)|丁寧に教え|教えます|同行|同じシフト|一緒に)/.test(t)) {
      out.push({level: 'hint', id: 'training', title: '「未経験歓迎」の裏付けがありません', hit: '', where: '',
        detail: '未経験の人は「本当に教えてもらえるか」を気にしています。', fix: '例：「最初の2週間は先輩と同じシフトに入ります。レジ操作はマニュアルあり」'});
    }
    if (!/(選考|面接|応募後|応募方法|応募の流れ)/.test(t)) {
      out.push({level: 'hint', id: 'apply-flow', title: '応募後の流れがありません', hit: '', where: '',
        detail: '応募したら何が起きるかが分かると、応募の心理的なハードルが下がります。', fix: '例：「応募 → 3日以内にお電話 → 面接1回（30分・私服可）→ 1週間以内に結果」'});
    }
    if (!/(交通費|通勤手当)/.test(t)) {
      out.push({level: 'hint', id: 'commute', title: '交通費の扱いがありません', hit: '', where: '',
        detail: '支給の有無・上限は、求職者がよく確かめる項目です。', fix: '例：「交通費 月2万円まで支給」／「支給なし（徒歩・自転車圏の方歓迎）」'});
    }
    if (t.replace(/\s/g, '').length < 400) {
      out.push({level: 'hint', id: 'short', title: '文章が短めです', hit: '', where: '',
        detail: '必要な項目と仕事の様子を書くと、多くの場合400字を超えます。', fix: '上の「見当たりません」の項目と、1日の流れ・人数を足す'});
    }
    if (!/(掲載日|更新日|掲載開始|[0-9]{4}\s*年\s*[0-9]{1,2}\s*月\s*[0-9]{1,2}\s*日\s*(現在|時点|掲載|更新))/.test(t)) {
      out.push({level: 'hint', id: 'dated', title: '掲載日（いつ時点の情報か）がありません', hit: '', where: '',
        detail: '求人の情報は正確で最新に保つ義務があり、掲載した時点を示すのがその方法の一つとされています。', fix: '末尾に「2026年10月2日 現在」のように入れる'});
    }
  }

  function check(text, opt) {
    opt = opt || {};
    var t = norm(text), out = [];
    if (!t.trim()) return {version: VERSION, findings: [], counts: {law: 0, missing: 0, hint: 0}, prefs: []};
    checkGender(t, out);
    checkAge(t, out);
    checkWage(t, out, opt);
    checkFixedOvertime(t, out);
    checkRequired(t, out);
    checkAppeal(t, out);
    var counts = {law: 0, missing: 0, hint: 0};
    out.forEach(function (f) { counts[f.level]++; });
    return {version: VERSION, findings: out, counts: counts, prefs: opt.pref ? [opt.pref] : detectPrefs(t)};
  }

  return {check: check, norm: norm, detectPrefs: detectPrefs, VERSION: VERSION, REQUIRED: REQUIRED};
})();
