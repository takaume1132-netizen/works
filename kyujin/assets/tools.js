// 小さな会社の労務の計算（ブラウザの各ページと、Python の試験が同じこのファイルを使う）。
// 根拠：労働基準法39条・同施行規則（年次有給休暇）、労働基準法36条（時間外労働の上限）、
// 最低賃金法（月給の確認方法）、厚生年金保険法・健康保険法と2025年の年金制度改正法（短時間労働者の加入）。
// 法的な判断ではなく、決まった式による計算。
var KyujinTools = (function () {
  'use strict';

  // ---------- 年次有給休暇の付与日数 ----------
  var STEPS = ['6か月', '1年6か月', '2年6か月', '3年6か月', '4年6か月', '5年6か月', '6年6か月以上'];
  var YUKYU = {
    5: [10, 11, 12, 14, 16, 18, 20],
    4: [7, 8, 9, 10, 12, 13, 15],
    3: [5, 6, 6, 8, 9, 10, 11],
    2: [3, 4, 4, 5, 6, 6, 7],
    1: [1, 2, 2, 2, 3, 3, 3]
  };

  // months：雇い入れからの月数。weekDays：週の所定労働日数（決まっていなければ yearDays：年間の所定労働日数）
  function yukyu(o) {
    var months = Number(o.months), hours = Number(o.weekHours || 0);
    var row;
    if (o.weekDays) {
      row = Math.min(5, Math.max(0, Math.floor(Number(o.weekDays))));
    } else {
      var y = Number(o.yearDays || 0);
      row = y >= 217 ? 5 : y >= 169 ? 4 : y >= 121 ? 3 : y >= 73 ? 2 : y >= 48 ? 1 : 0;
    }
    var full = hours >= 30 || row >= 5;  // 週30時間以上なら、週4日以下でも通常の日数
    if (full) row = 5;
    if (row === 0) return {days: 0, step: null, proportional: false, note: '週1日未満（年48日未満）の場合は、付与の対象になりません。'};
    if (months < 6) return {days: 0, step: null, proportional: !full, note: '雇い入れから6か月たつと、初めて付与されます（その間の出勤率が8割以上の場合）。'};
    var idx = Math.min(6, Math.floor((months - 6) / 12));
    var nextMonths = idx < 6 ? 6 + (idx + 1) * 12 : null;
    return {days: YUKYU[row][idx], step: STEPS[idx], proportional: !full, row: row, table: YUKYU[row].slice(),
      next: nextMonths ? {months: nextMonths, days: YUKYU[row][idx + 1]} : null,
      note: '直前の1年（初回は6か月）の出勤率が8割以上の場合の日数です。年10日以上付与される人には、年5日を取らせる義務があります。'};
  }

  // ---------- 時間外労働の上限（36協定） ----------
  // months：12か月分の [{ot: 時間外労働, hol: 法定休日労働}]。special：特別条項の有無。henkei：対象期間3か月超の1年単位の変形労働時間制
  function zangyo(o) {
    var ms = (o.months || []).map(function (m) { return {ot: Number(m.ot || 0), hol: Number(m.hol || 0)}; });
    var lim = o.henkei ? {m: 42, y: 320} : {m: 45, y: 360};
    var out = [], sumOt = 0, over45 = 0;
    ms.forEach(function (m, i) {
      sumOt += m.ot;
      if (m.ot > lim.m) over45++;
      if (m.ot + m.hol >= 100) out.push({level: 'law', title: (i + 1) + 'か月目：時間外＋休日労働が100時間以上', detail: '特別条項があっても、時間外労働と休日労働の合計は月100時間未満にする必要があります（' + (m.ot + m.hol) + '時間）。'});
    });
    if (!o.special) {
      ms.forEach(function (m, i) {
        if (m.ot > lim.m) out.push({level: 'law', title: (i + 1) + 'か月目：月' + lim.m + '時間を超えています', detail: '特別条項のない36協定では、時間外労働は月' + lim.m + '時間・年' + lim.y + '時間までです（' + m.ot + '時間）。'});
      });
      if (sumOt > lim.y) out.push({level: 'law', title: '年' + lim.y + '時間を超えています', detail: '時間外労働の年間合計が' + sumOt + '時間です。'});
    } else {
      if (sumOt > 720) out.push({level: 'law', title: '年720時間を超えています', detail: '特別条項があっても、時間外労働（休日労働を除く）は年720時間までです（' + sumOt + '時間）。'});
      if (over45 > 6) out.push({level: 'law', title: '月' + lim.m + '時間を超えた月が年6回を超えています', detail: '月' + lim.m + '時間を超えられるのは年6か月までです（' + over45 + 'か月）。'});
    }
    // 2〜6か月の平均（時間外＋休日）が80時間以内か。特別条項の有無にかかわらず、どの連続した期間も確かめる
    for (var len = 2; len <= 6; len++) {
      for (var s = 0; s + len <= ms.length; s++) {
        var tot = 0;
        for (var k = s; k < s + len; k++) tot += ms[k].ot + ms[k].hol;
        var avg = tot / len;
        if (avg > 80) {
          out.push({level: 'law', title: (s + 1) + '〜' + (s + len) + 'か月目の' + len + 'か月平均が80時間を超えています',
            detail: '時間外労働と休日労働の合計の平均は、2〜6か月のどの期間でも80時間以内にする必要があります（平均' + (Math.round(avg * 10) / 10) + '時間）。'});
        }
      }
    }
    return {findings: out, totalOt: sumOt, over45: over45, limit: lim,
      note: '建設業・自動車運転の業務・医師などは、2024年4月から別の上限が定められています。'};
  }

  // ---------- 月給と最低賃金 ----------
  // pay：最低賃金の対象になる月の賃金（基本給＋職務手当など。通勤・家族・精皆勤手当、残業代、賞与などは除く）
  // yearHolidays と dayHours から月平均所定労働時間を出す（monthHours を直接入れてもよい）
  function gekkyu(o) {
    var monthHours = o.monthHours ? Number(o.monthHours) : (365 - Number(o.yearHolidays)) * Number(o.dayHours) / 12;
    if (!(monthHours > 0)) return null;
    var hourly = Number(o.pay) / monthHours;
    var mw = (typeof KyujinMinWage !== 'undefined' && o.pref) ? KyujinMinWage.at(o.pref, o.date || new Date().toISOString().slice(0, 10)) : null;
    var r = {monthHours: Math.round(monthHours * 100) / 100, hourly: Math.floor(hourly * 100) / 100, minwage: mw};
    if (mw) {
      r.ok = hourly >= mw.current;
      r.okNext = mw.next ? hourly >= mw.next : r.ok;
      r.needPay = Math.ceil(mw.current * monthHours);
      if (mw.next) r.needPayNext = Math.ceil(mw.next * monthHours);
    }
    return r;
  }

  // ---------- パート・アルバイトの社会保険（厚生年金・健康保険） ----------
  var SIZE_STEPS = [['2027-10-01', 36], ['2029-10-01', 21], ['2032-10-01', 11], ['2035-10-01', 1]];

  function sizeLine(date) {  // その日の「特定適用事業所」の人数の下限（被保険者数。短時間労働者を除く）
    var n = 51;
    SIZE_STEPS.forEach(function (s) { if (date >= s[0]) n = s[1]; });
    return n;
  }

  // weekHours・monthDays：その人の所定。fullWeekHours・fullMonthDays：同じ会社のフルタイムの人の所定。
  // employees：会社の厚生年金の被保険者数（短時間労働者を除く）。corp：法人か。agreement：労使合意で任意に適用しているか。
  // over2months：2か月を超えて雇う見込みか。student：昼間の学生か。monthlyWage：月の賃金（2026年9月までの判定に使う）
  function shaho(o) {
    var date = o.date || new Date().toISOString().slice(0, 10);
    var reasons = [];
    if (!o.corp && !o.appliedOffice) {
      return {result: 'check', reasons: ['個人事業の店・事務所は、業種と人数（常時5人以上か）によって、そもそも社会保険の適用事業所でない場合があります。年金事務所にご確認ください。']};
    }
    var q = (Number(o.weekHours) >= Number(o.fullWeekHours) * 0.75) && (Number(o.monthDays) >= Number(o.fullMonthDays) * 0.75);
    if (q) return {result: 'join', reasons: ['週の所定労働時間と月の所定労働日数が、どちらもフルタイムの人の4分の3以上です。会社の規模に関係なく加入します。'], timeline: []};
    var line = sizeLine(date);
    var covered = o.agreement || Number(o.employees) >= line;
    var cond = [];
    if (Number(o.weekHours) < 20) cond.push('週の所定労働時間が20時間未満');
    if (!o.over2months) cond.push('2か月を超えて雇う見込みがない');
    if (o.student) cond.push('昼間の学生（休学中・夜間などを除く）');
    if (date < '2026-10-01' && Number(o.monthlyWage || 0) < 88000) cond.push('月の賃金が8.8万円未満（この要件は2026年10月1日になくなりました）');
    var timeline = [];
    if (!o.agreement) {
      SIZE_STEPS.forEach(function (s) {
        if (s[0] > date && Number(o.employees) >= s[1] && Number(o.employees) < line) timeline.push(s[0]);
      });
    }
    if (covered && !cond.length) {
      reasons.push(o.agreement ? '労使の合意で短時間労働者にも適用している会社で、' : '被保険者が' + line + '人以上の会社（特定適用事業所）で、');
      reasons.push('週20時間以上・2か月を超える見込み・学生でない、の条件をすべて満たします。');
      return {result: 'join', reasons: reasons, timeline: []};
    }
    if (!covered) reasons.push('会社の被保険者が' + line + '人未満のため、いまは短時間労働者の加入の対象外です（フルタイムの4分の3未満の人の場合）。');
    cond.forEach(function (c) { reasons.push('加入しない理由：' + c + '。'); });
    var future = timeline.length && !cond.filter(function (c) { return c.indexOf('8.8万') < 0; }).length ? timeline[0] : null;
    return {result: 'nojoin', reasons: reasons, from: future, timeline: timeline};
  }

  // ---------- カスハラ対策（2026年10月1日から全事業主の義務） ----------
  // 厚生労働省の指針の「雇用管理上の措置」：5本の柱・10項目
  var KASUHARA_CHECKS = [
    ['方針', 'カスハラには毅然と対応し、従業員を守るという方針を決め、従業員に知らせている'],
    ['方針', 'どんな言動がカスハラに当たるか、そのときの対処（報告・複数で対応・警察への通報など）を従業員に知らせている'],
    ['相談', '相談窓口（担当者）を決め、従業員に知らせている'],
    ['相談', 'カスハラに当たるか迷う相談にも、窓口が対応できるようにしている'],
    ['事後', '起きたときに、事実関係を早く正確に確かめる'],
    ['事後', '被害を受けた従業員に配慮する（担当を替える・休ませる・心身のケアなど）'],
    ['事後', '再発を防ぐ措置をとる（事実が確かめられない場合も）'],
    ['抑止', '悪質な場合の対処（警察への通報・警告・出入り禁止など）と、誰が判断するかを先に決めている'],
    ['その他', '相談した人のプライバシーを守ることを決め、従業員に知らせている'],
    ['その他', '相談したことを理由に不利益な扱いをしないことを決め、従業員に知らせている']
  ];

  // name：店名・会社名、boss：判断する人（店長など）、desk：相談窓口の担当、contact：相談の方法
  function kasuhara(o) {
    var name = o.name || '当店', boss = o.boss || '店長', desk = o.desk || boss, contact = o.contact || '直接、または電話で';
    var policy = [
      name + 'のカスタマーハラスメントに対する方針',
      '',
      name + 'は、お客さまに誠実に対応します。一方で、従業員の尊厳を傷つける言動には毅然と対応し、従業員を守ります。',
      '次のような言動があった場合は、対応をお断りし、必要に応じて警察に通報します。',
      '・暴言、大声、威圧的な言動、脅し',
      '・暴力、物を投げる・壊す',
      '・土下座の要求など、人格を否定する要求',
      '・長時間の居座りや電話、繰り返しの来店・電話による拘束',
      '・商品やサービスと関係のない、または過大な要求',
      '・従業員の写真や個人情報を、本人の同意なくSNSなどに載せること',
      '・性的な言動、つきまといなどのセクシュアルハラスメント'
    ].join('\n');
    var notice = [
      'お客さまへのお願い',
      '',
      name + 'では、お客さまに気持ちよくご利用いただけるよう努めております。',
      '従業員への暴言・威圧的な言動・長時間の拘束などがあった場合は、対応をお断りし、警察に通報することがあります。',
      '従業員が安心して働ける環境づくりに、ご理解とご協力をお願いいたします。'
    ].join('\n');
    var steps = [
      'カスハラが起きたときの対応（従業員向け）',
      '',
      '1. 一人で抱えず、すぐに' + boss + 'に知らせる（' + boss + 'がいないときは、その場の責任者）',
      '2. できるだけ2人以上で対応する。相手の要求にその場で約束はしない',
      '3. 暴力や脅しがあれば、身の安全を優先し、ためらわずに110番する',
      '4. 退店や電話の終了をお願いしても続く場合は、' + boss + 'が対応を打ち切る',
      '5. 日時・場所・相手の言動・対応した人・その後の様子を、記録票に書く',
      '6. 出入りをお断りするか、警告文を出すかは、' + boss + 'が決める',
      '7. 対応した従業員の担当替えや休憩など、心身の負担に配慮する'
    ].join('\n');
    var desk_text = [
      'カスハラの相談窓口',
      '',
      '担当：' + desk,
      '相談の方法：' + contact,
      '・カスハラに当たるか迷うことでも、相談できます',
      '・相談した人や、相談の内容は、本人の同意なく他の人に伝えません',
      '・相談したことを理由に、不利益な扱いをすることはありません',
      '・求職者（応募してきた人）へのセクシュアルハラスメントの相談も受け付けます'
    ].join('\n');
    var record = '記録票の項目：日時／場所／相手（分かる範囲）／言動の内容（そのままの言葉）／対応した人／とった対応／警察への連絡の有無／被害を受けた従業員の様子と配慮／再発防止のためにすること';
    return {policy: policy, notice: notice, steps: steps, desk: desk_text, record: record, checks: KASUHARA_CHECKS};
  }

  return {yukyu: yukyu, zangyo: zangyo, gekkyu: gekkyu, shaho: shaho, kasuhara: kasuhara, sizeLine: sizeLine,
    YUKYU: YUKYU, STEPS: STEPS, SIZE_STEPS: SIZE_STEPS, KASUHARA_CHECKS: KASUHARA_CHECKS};
})();
