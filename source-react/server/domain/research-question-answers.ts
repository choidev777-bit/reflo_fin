import {
  canonicalResearchNumericValue,
  type ResearchPlanQuestion,
  type ValidatedEvidence,
} from "./research-validation";

export type ResearchVerdict =
  | "positive"
  | "neutral"
  | "negative"
  | "indeterminate";

export type ResearchQuestionAnswer = {
  questionId: string;
  verdict: ResearchVerdict;
  oneLineAnswer: string;
  evidenceCandidateKeys: string[];
  caveat: string | null;
  policyVersion: "stance-balance-v1";
};

export type QuestionAnswerDecision = {
  question: ResearchPlanQuestion;
  verdict: ResearchVerdict;
  evidence: ValidatedEvidence[];
  readyForSynthesis: boolean;
  caveat: string | null;
  policyVersion: "stance-balance-v1";
};

export type StoredQuestionResult = {
  metricId: string;
  oneLineValue: string;
  stance: "supporting" | "contradicting" | "neutral";
  evidenceIds: string[];
};

export function decideStoredQuestionAnswer(input: {
  requiredMetricIds: string[];
  results: StoredQuestionResult[];
}): {
  verdict: ResearchVerdict;
  oneLineAnswer: string;
  evidenceIds: string[];
  caveat: string | null;
} {
  const covered = new Set(input.results.map((result) => result.metricId));
  const missing = input.requiredMetricIds.filter(
    (metricId) => !covered.has(metricId),
  );
  const evidenceIds = [
    ...new Set(input.results.flatMap((result) => result.evidenceIds)),
  ];
  if (input.results.length === 0) {
    return {
      verdict: "indeterminate",
      oneLineAnswer: "보고서에 반영할 검증 주장이 없습니다.",
      evidenceIds,
      caveat: "검증을 통과한 근거가 없습니다.",
    };
  }
  const supporting = input.results.filter(
    (result) => result.stance === "supporting",
  ).length;
  const contradicting = input.results.filter(
    (result) => result.stance === "contradicting",
  ).length;
  return {
    verdict:
      supporting > 0 && contradicting === 0
        ? "positive"
        : contradicting > 0 && supporting === 0
          ? "negative"
          : "neutral",
    oneLineAnswer: input.results
      .map((result) => result.oneLineValue)
      .join("; ")
      .slice(0, 500),
    evidenceIds,
    caveat:
      missing.length > 0 ? `보고서 제외 지표: ${missing.join(", ")}` : null,
  };
}

export function decideQuestionAnswers(input: {
  questions: ResearchPlanQuestion[];
  evidence: ValidatedEvidence[];
}): QuestionAnswerDecision[] {
  return input.questions
    .filter((question) => question.included)
    .map((question) => {
      const evidence = input.evidence.filter(
        (item) =>
          item.questionId === question.questionId &&
          item.machineStatus === "passed",
      );
      const covered = new Set(evidence.map((item) => item.metricId));
      const missing = question.metrics.filter((metric) => !covered.has(metric));
      const valuesByMetricPeriod = new Map<string, Set<string>>();
      for (const item of evidence) {
        const value = canonicalResearchNumericValue(item.valueNormalized);
        if (!value) continue;
        const metricPeriod = [
          item.metricId.trim(),
          item.period.trim(),
          item.scope.trim(),
        ].join("\u0000");
        const values = valuesByMetricPeriod.get(metricPeriod) ?? new Set();
        values.add(
          [value, item.unit?.trim() ?? "", item.currency?.trim() ?? ""].join(
            "\u0000",
          ),
        );
        valuesByMetricPeriod.set(metricPeriod, values);
      }
      const conflict = Array.from(valuesByMetricPeriod.values()).some(
        (values) => values.size > 1,
      );
      if (conflict || evidence.length === 0) {
        return {
          question,
          verdict: "indeterminate" as const,
          evidence,
          readyForSynthesis: false,
          caveat:
            conflict
              ? "같은 지표와 기간의 검증값이 충돌합니다."
              : "검증을 통과한 근거가 없습니다.",
          policyVersion: "stance-balance-v1" as const,
        };
      }
      const supporting = evidence.filter(
        (item) => item.stance === "supporting",
      ).length;
      const contradicting = evidence.filter(
        (item) => item.stance === "contradicting",
      ).length;
      const verdict =
        supporting > 0 && contradicting === 0
          ? ("positive" as const)
          : contradicting > 0 && supporting === 0
            ? ("negative" as const)
            : ("neutral" as const);
      return {
        question,
        verdict,
        evidence,
        readyForSynthesis: true,
        caveat:
          missing.length > 0
            ? `보고서 제외 지표: ${missing.join(", ")}`
            : null,
        policyVersion: "stance-balance-v1" as const,
      };
    });
}

function numericTokens(value: string): string[] {
  return (value.match(/[-+]?\d[\d,.]*%?/g) ?? []).map((token) =>
    token.replaceAll(",", "").replace(/%$/, "").replace(/^\+/, ""),
  );
}

export function validateQuestionAnswer(
  answer: ResearchQuestionAnswer,
  decision: QuestionAnswerDecision,
): ResearchQuestionAnswer {
  const normalizedAnswer = answer.oneLineAnswer.trim();
  if (
    answer.questionId !== decision.question.questionId ||
    answer.verdict !== decision.verdict ||
    answer.policyVersion !== decision.policyVersion
  ) {
    throw new Error("QUESTION_ANSWER_POLICY_MISMATCH");
  }
  if (
    normalizedAnswer.length === 0 ||
    normalizedAnswer.length > 500 ||
    /[\r\n]/.test(normalizedAnswer)
  ) {
    throw new Error("QUESTION_ANSWER_FORMAT_INVALID");
  }
  const allowedKeys = new Set(
    decision.evidence.map((item) => item.candidateKey),
  );
  if (
    answer.evidenceCandidateKeys.length === 0 ||
    answer.evidenceCandidateKeys.some((key) => !allowedKeys.has(key))
  ) {
    throw new Error("QUESTION_ANSWER_EVIDENCE_INVALID");
  }
  const referenced = decision.evidence.filter((item) =>
    answer.evidenceCandidateKeys.includes(item.candidateKey),
  );
  const allowedNumbers = new Set(
    referenced.flatMap((item) =>
      numericTokens(
        [
          item.quoteExact,
          item.oneLineValue,
          item.valueOriginal ?? "",
          item.valueNormalized ?? "",
        ].join(" "),
      ),
    ),
  );
  if (
    numericTokens(answer.oneLineAnswer).some(
      (token) => !allowedNumbers.has(token),
    )
  ) {
    throw new Error("QUESTION_ANSWER_NUMBER_UNSUPPORTED");
  }
  return {
    ...answer,
    oneLineAnswer: normalizedAnswer,
    evidenceCandidateKeys: [...new Set(answer.evidenceCandidateKeys)],
    caveat: decision.caveat,
  };
}

export function indeterminateQuestionAnswer(
  decision: QuestionAnswerDecision,
): ResearchQuestionAnswer {
  return {
    questionId: decision.question.questionId,
    verdict: "indeterminate",
    oneLineAnswer: "필수 근거가 부족하거나 충돌해 현재 판단할 수 없습니다.",
    evidenceCandidateKeys: decision.evidence.map((item) => item.candidateKey),
    caveat: decision.caveat,
    policyVersion: decision.policyVersion,
  };
}

export function validateQuestionAnswerSet(input: {
  questions: ResearchPlanQuestion[];
  evidence: ValidatedEvidence[];
  answers: ResearchQuestionAnswer[];
}): ResearchQuestionAnswer[] {
  const candidateKeys = new Set<string>();
  for (const item of input.evidence) {
    if (candidateKeys.has(item.candidateKey)) {
      throw new Error("EVIDENCE_CANDIDATE_KEY_CONFLICT");
    }
    candidateKeys.add(item.candidateKey);
  }
  const decisions = decideQuestionAnswers({
    questions: input.questions,
    evidence: input.evidence,
  });
  const answerByQuestion = new Map<string, ResearchQuestionAnswer>();
  for (const answer of input.answers) {
    if (answerByQuestion.has(answer.questionId)) {
      throw new Error("QUESTION_ANSWER_DUPLICATE");
    }
    answerByQuestion.set(answer.questionId, answer);
  }
  if (
    answerByQuestion.size !== decisions.length ||
    decisions.some(
      (decision) => !answerByQuestion.has(decision.question.questionId),
    )
  ) {
    throw new Error("QUESTION_ANSWER_SET_MISMATCH");
  }
  return decisions.map((decision) => {
    const answer = answerByQuestion.get(decision.question.questionId)!;
    if (decision.readyForSynthesis) {
      return validateQuestionAnswer(answer, decision);
    }
    const expected = indeterminateQuestionAnswer(decision);
    if (
      answer.verdict !== expected.verdict ||
      answer.oneLineAnswer !== expected.oneLineAnswer ||
      answer.policyVersion !== expected.policyVersion ||
      answer.caveat !== expected.caveat ||
      answer.evidenceCandidateKeys.length !==
        expected.evidenceCandidateKeys.length ||
      answer.evidenceCandidateKeys.some(
        (key) => !expected.evidenceCandidateKeys.includes(key),
      )
    ) {
      throw new Error("QUESTION_ANSWER_POLICY_MISMATCH");
    }
    return expected;
  });
}
