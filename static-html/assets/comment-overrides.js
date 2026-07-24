(() => {
  const orderRows = (direction) => {
    const table = document.querySelector('.projects-records .record-table');
    if (!table) return;
    const rows = Array.from(table.querySelectorAll(':scope > .record-row'));
    rows.sort((a, b) => {
      const aOrder = Number(a.dataset.projectOrder ?? rows.indexOf(a));
      const bOrder = Number(b.dataset.projectOrder ?? rows.indexOf(b));
      return direction === 'oldest' ? bOrder - aOrder : aOrder - bOrder;
    });
    rows.forEach((row) => table.append(row));
  };

  const applyReviewChanges = () => {
    document.querySelectorAll('label').forEach((label) => {
      if (label.textContent?.trim() === '분석 구조 *' && label.firstChild?.nodeType === Node.TEXT_NODE) label.firstChild.nodeValue = '기업 분야 ';
    });
    document.querySelectorAll('option').forEach((option) => {
      if (option.textContent?.trim() === '분석 구조 선택') option.textContent = '기업 분야 선택';
    });
    document.querySelectorAll('.spec-info-note').forEach((note) => {
      const nextText = note.textContent.replaceAll('선택한 유형과 분석 구조에 따라', '선택한 리포트 유형과 기업 분야에 따라');
      if (note.textContent !== nextText) note.textContent = nextText;
    });
    document.querySelectorAll('.spec-project-setup .spec-screen-head span, .spec-project-setup .spec-screen-copy, .spec-project-setup > header p').forEach((copy) => {
      const nextText = copy.textContent.replaceAll('리포트 유형·분석 구조', '리포트 유형·기업 분야');
      if (copy.textContent !== nextText) copy.textContent = nextText;
    });
    document.querySelectorAll('.spec-readonly-match > b, .spec-company-confirm').forEach((element) => element.remove());
    document.querySelectorAll('select[aria-label="분기 필터"]').forEach((element) => element.remove());
    document.querySelectorAll('select[aria-label="상태 필터"]').forEach((element) => {
      if (element.dataset.reviewReplacement) return;
      const replacement = document.createElement('select');
      replacement.className = element.className;
      replacement.setAttribute('aria-label', '정렬 필터');
      replacement.dataset.reviewReplacement = 'true';
      replacement.innerHTML = '<option value="latest">최신순</option><option value="oldest">오래된순</option>';
      replacement.addEventListener('change', () => orderRows(replacement.value));
      element.replaceWith(replacement);
      orderRows('latest');
    });
  };

  const applyUploadReviewChanges = () => {};

  const applyNextLabelChanges = () => {
    const currentStep = document.querySelector('.spec-screen-head p')?.textContent?.trim();
    if (currentStep === 'STEP 04' || currentStep === 'STEP 05') return;
    document.querySelectorAll('.spec-bottom-bar .spec-next').forEach((button) => {
      const label = '\ub2e4\uc74c ';
      const textNode = Array.from(button.childNodes).find((node) => node.nodeType === Node.TEXT_NODE);
      if (textNode && textNode.nodeValue !== label) textNode.nodeValue = label;
      if (!textNode) button.prepend(document.createTextNode(label));
    });
  };

  const applyExcelStepRemoval = () => {
    document.querySelectorAll('.spec-sidebar nav button, .spec-workflow-dialog button').forEach((button) => {
      if (/Excel \uc5c5\ub370\uc774\ud2b8/.test(button.textContent || '')) button.remove();
    });

    const excelScreen = document.querySelector('.spec-excel-update-layout');
    if (!excelScreen || excelScreen.dataset.reviewSkipped) return;
    excelScreen.dataset.reviewSkipped = 'true';
    window.setTimeout(() => document.querySelector('.spec-bottom-bar .spec-next:not(:disabled)')?.click(), 0);
  };

  new MutationObserver(() => {
    applyReviewChanges();
    applyUploadReviewChanges();
    applyNextLabelChanges();
    applyExcelStepRemoval();
  }).observe(document.documentElement, { childList: true, subtree: true });
  applyReviewChanges();
  applyUploadReviewChanges();
  applyNextLabelChanges();
  applyExcelStepRemoval();
})();
