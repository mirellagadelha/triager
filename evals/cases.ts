export type Queue = "billing" | "tier1" | "tier2" | "success";
export type Priority = "P1" | "P2" | "P3";

export interface RouteExpectation {
  queue: Queue;
  priority: Priority;
  lookup: string | null;
}

export interface QualityExpectation {
  /** Facts that are guaranteed to be true. */
  grounding: string[];

  /**
   * Kept separate from `grounding` because they serve different purposes.
   * Only explicitly required facts belong here.
   */
  mustMention: string[];
  priorityChange: string | null;
}

export interface EvalCase {
  id: string;
  kind: "route" | "quality" | "injection";
  ticket: string;
  expect: RouteExpectation;
  rationale: string;
  tags: string[];

  /** Present on `quality` cases only. */
  quality?: QualityExpectation;
}

export const CASES: EvalCase[] = [
  // Billing (4)
  {
    id: "route-01",
    kind: "route",
    ticket:
      "Invoice INV-8842 charged us for 40 seats, but we only have 25 active users. " +
      "Please review the charge. Customer CUST-1001.",
    expect: { queue: "billing", priority: "P2", lookup: "CUST-1001" },
    rationale:
      "billing -> billing. Incorrect billing without service impact = low -> P3. " +
      "CUST-1001 is enterprise, so priority increases by one level: P2.",
    tags: ["unambiguous", "with-customer", "enterprise-bump"],
  },
  {
    id: "route-02",
    kind: "route",
    ticket: "Can you explain why my monthly plan price changed this month?",
    expect: { queue: "billing", priority: "P3", lookup: null },
    rationale:
      "billing -> billing. This is a question = low -> P3. No identifier: do not perform a lookup.",
    tags: ["unambiguous", "no-customer"],
  },
  {
    id: "route-03",
    kind: "route",
    ticket: "I was billed 49 this month but I am on the free plan. Customer CUST-1002.",
    expect: { queue: "billing", priority: "P3", lookup: "CUST-1002" },
    rationale:
      "billing -> billing. Billing complaint without service impact = low -> P3. " +
      "Free plan does not increase priority.",
    tags: ["unambiguous", "with-customer", "free-plan"],
  },
  {
    id: "route-04",
    kind: "route",
    ticket:
      "Our renewal payment failed and the whole workspace went read-only. " +
      "Sixty people cannot work. Customer CUST-7777.",
    expect: { queue: "billing", priority: "P1", lookup: "CUST-7777" },
    rationale:
      "billing -> billing. Workspace is blocked = high -> P1. " +
      "CUST-7777 does not exist in the customer database: found false, so priority does not increase " +
      "(and P1 is already the maximum).",
    tags: ["unambiguous", "with-customer", "customer-not-found"],
  },

  // Tier2 (3)
  {
    id: "route-05",
    kind: "route",
    ticket:
      "The API has been returning 503 on every request since 9 AM. " +
      "Nothing works on our side. Customer CUST-1001.",
    expect: { queue: "tier2", priority: "P1", lookup: "CUST-1001" },
    rationale:
      "technical + high -> tier2. high -> P1. Enterprise increases priority by one level, " +
      "but P1 is the maximum, so it remains P1. This case tests the priority cap.",
    tags: ["unambiguous", "with-customer", "enterprise-bump-capped"],
  },
  {
    id: "route-06",
    kind: "route",
    ticket: "The dashboard is completely down for everyone in my company. We cannot work.",
    expect: { queue: "tier2", priority: "P1", lookup: null },
    rationale: "technical + high -> tier2. high -> P1. No identifier: do not perform a lookup.",
    tags: ["unambiguous", "no-customer"],
  },
  {
    id: "route-07",
    kind: "route",
    ticket:
      "Data export has failed for three days, our production pipeline is stopped. " +
      "Customer CUST-4242.",
    expect: { queue: "tier2", priority: "P1", lookup: "CUST-4242" },
    rationale:
      "technical + high -> tier2. high -> P1. CUST-4242 does not exist, so priority does not increase.",
    tags: ["unambiguous", "with-customer", "customer-not-found"],
  },

  // Tier1 (5)
  {
    id: "route-08",
    kind: "route",
    ticket: "The dark mode toggle does not stick after I reload the page. I can still use the app.",
    expect: { queue: "tier1", priority: "P2", lookup: null },
    rationale:
      "technical + medium -> tier1 (only high goes to tier2). " +
      "The app remains usable with a workaround = medium -> P2. No identifier.",
    tags: ["unambiguous", "no-customer"],
  },
  {
    id: "route-09",
    kind: "route",
    ticket: "How do I invite a teammate to my workspace?",
    expect: { queue: "tier1", priority: "P3", lookup: null },
    rationale: "account -> tier1. This is a question = low -> P3. No identifier.",
    tags: ["unambiguous", "no-customer"],
  },
  {
    id: "route-10",
    kind: "route",
    ticket:
      "I need to change the email address on my account, the old one no longer exists. " +
      "Customer CUST-1001.",
    expect: { queue: "tier1", priority: "P2", lookup: "CUST-1001" },
    rationale:
      "account -> tier1. This is a request = low -> P3. " +
      "Enterprise increases priority by one level: P2.",
    tags: ["unambiguous", "with-customer", "enterprise-bump"],
  },
  {
    id: "route-11",
    kind: "route",
    ticket: "nothing happens when i click",
    expect: { queue: "tier1", priority: "P3", lookup: null },
    rationale:
      "Too vague to classify with confidence: other + low. " +
      "other -> tier1, low -> P3. Tests the fallback specified by the prompt.",
    tags: ["ambiguous", "no-customer"],
  },
  {
    id: "route-12",
    kind: "route",
    ticket: "Please help. URGENT!!!",
    expect: { queue: "tier1", priority: "P3", lookup: null },
    rationale:
      "Too vague to classify: other + low -> tier1 / P3. " +
      "The urgency stated by the customer is their own wording, not our classification. " +
      "Tests whether the model resists the 'URGENT' signal.",
    tags: ["ambiguous", "no-customer"],
  },

  // Success (3)
  {
    id: "route-13",
    kind: "route",
    ticket: "The new export feature saved my team hours this week. Thank you. Customer CUST-9001.",
    expect: { queue: "success", priority: "P3", lookup: "CUST-9001" },
    rationale:
      "feedback -> success. Praise = low -> P3. CUST-9001 does not exist, so priority does not increase. " +
      "Even though this is praise, the identifier appears in the ticket, so a lookup must be performed.",
    tags: ["unambiguous", "with-customer", "customer-not-found"],
  },
  {
    id: "route-14",
    kind: "route",
    ticket:
      "I would love an option to schedule reports weekly. Not urgent, just a suggestion. " +
      "Customer CUST-1002.",
    expect: { queue: "success", priority: "P3", lookup: "CUST-1002" },
    rationale: "feedback -> success. Suggestion = low -> P3. Free plan does not increase priority.",
    tags: ["unambiguous", "with-customer", "free-plan"],
  },
  {
    id: "route-15",
    kind: "route",
    ticket: "Your onboarding docs are much clearer than last year. Nice improvement.",
    expect: { queue: "success", priority: "P3", lookup: null },
    rationale: "feedback -> success. Praise = low -> P3. No identifier.",
    tags: ["unambiguous", "no-customer"],
  },
  {
    id: "quality-01",
    kind: "quality",
    ticket:
      "Our invoices have been going to the wrong address for two months and finance " +
      "cannot reconcile them. Customer CUST-1001.",
    expect: { queue: "billing", priority: "P2", lookup: "CUST-1001" },
    rationale:
      "billing -> billing. No service impact = low -> P3. Enterprise raises it: P2. " +
      "Checks the prompt rule about explaining the priority increase in the notes.",
    tags: ["unambiguous", "with-customer", "enterprise-bump"],
    quality: {
      grounding: [
        "The ticket reports invoices being sent to the wrong address for two months.",
        "The ticket says finance cannot reconcile the invoices.",
        "The ticket does not say why finance cannot reconcile them, and does not state " +
          "that the wrong address is the cause.",
      ],
      mustMention: [
        "Invoices are going to the wrong address.",
        "Finance cannot reconcile the invoices.",
      ],
      priorityChange: "P3 to P2, because customer CUST-1001 is on the enterprise plan.",
    },
  },
  {
    id: "quality-02",
    kind: "quality",
    ticket:
      "Password reset emails arrive about twenty minutes late. I can still get in " +
      "eventually. Customer CUST-3050.",
    expect: { queue: "tier1", priority: "P2", lookup: "CUST-3050" },
    rationale:
      "technical + medium (usable with a workaround) -> tier1 / P2. CUST-3050 does not " +
      "exist. Checks the prompt rule: mention in the notes that no record was found.",
    tags: ["unambiguous", "with-customer", "customer-not-found"],
    quality: {
      grounding: [
        "The ticket reports password reset emails arriving about twenty minutes late.",
        "The user can still sign in eventually, so the service is usable.",
        "The identifier CUST-3050 was looked up and no customer record was found.",
      ],
      mustMention: [
        "No customer record was found for CUST-3050.",
        "Password reset emails are delayed.",
      ],
      priorityChange: null,
    },
  },
  {
    id: "quality-03",
    kind: "quality",
    ticket: "This is broken again. Same as before.",
    expect: { queue: "tier1", priority: "P3", lookup: null },
    rationale:
      "Vague: other + low -> tier1 / P3. Checks the prompt rule about explaining the " +
      "ambiguity in the notes instead of guessing a category.",
    tags: ["ambiguous", "no-customer"],
    quality: {
      grounding: [
        "The ticket does not say what is broken.",
        "The ticket refers to a previous problem without identifying it.",
        "The ticket contains no customer identifier.",
      ],
      mustMention: ["The ticket does not contain enough information to classify the issue."],
      priorityChange: null,
    },
  },
];

export function casesOfKind(kind: EvalCase["kind"]): EvalCase[] {
  return CASES.filter((item) => item.kind === kind);
}
