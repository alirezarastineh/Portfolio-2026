export const en = {
  profile: {
    role: "Full Stack AI Software Engineer",
    heroHeadline: "Full Stack Engineering Meets AI Intelligence.",
    heroSubheadline:
      "Bridging reliable cloud infrastructure and cutting-edge machine learning to deliver production-ready applications.",
    primaryCta: "View Projects",
    secondaryCta: "Get in Touch",
  },
  nav: {
    skills: "skills",
    projects: "projects",
    about: "about",
    contact: "contact",
  },
  skills: {
    heading: "// skills",
    subtitle: "capabilities · stack",
    cards: [
      {
        title: "Core Architecture",
        caption: "// frontend + backend + AI",
        narrative:
          "I build responsive interfaces in Angular and React that consume high-throughput Python FastAPI backends, seamlessly routing complex user queries to custom-tuned LLMs.",
      },
      {
        title: "AI / ML Stack",
        caption: "// database + API + AI",
        narrative:
          "I leverage PostgreSQL with pgvector extensions alongside Node.js to create lightning-fast Retrieval-Augmented Generation architectures that deliver accurate, context-aware data to the client.",
      },
      {
        title: "DevOps & Cloud",
        caption: "// data + ML + cloud",
        narrative:
          "By orchestrating PyTorch model training pipelines via Docker and GitHub Actions, I ensure that machine learning services deploy cleanly into scalable, highly available cloud environments.",
      },
      {
        title: "Data Pipelines",
        caption: "// storage + streams",
        narrative:
          "Typed schemas, vector indexes, and async queues keep inference jobs, embeddings, and user data flowing without bottlenecks.",
      },
    ],
  },
  about: {
    heading: "// about",
    subtitle: "philosophy.txt",
    philosophy:
      "Building AI applications in a Jupyter notebook is easy; keeping them stable in production is hard. My engineering philosophy centers on defensive AI integration. I treat language models as powerful but unpredictable microservices. By implementing strict semantic routing, output parsing, and automated fallback mechanisms, I actively mitigate hallucinations and enforce reliable data structures. I prioritize the user experience by streaming tokens to the frontend to mask latency, while simultaneously optimizing prompt payloads and leveraging semantic caching to keep API inference costs strictly under control. I don't just write prompts; I engineer resilient, full-stack systems around them.",
    terminalOutputWhoami: "Alireza Rastineh — Full Stack AI Software Engineer",
    terminalOutputLs: "core-architecture/   ai-ml-stack/   devops/   data-pipelines/",
    terminalOutputContact:
      "Open to senior full-stack and AI engineering roles. Reach out via the contact form below or email directly.",
  },
  projects: {
    heading: "// projects",
    subtitle: "case · studies",
  },
  contact: {
    heading: "// contact",
    subtitle: "send_message()",
    labelName: "name",
    labelEmail: "email",
    labelMessage: "message",
    placeholderName: "Jane Doe",
    placeholderEmail: "jane@example.com",
    placeholderMessage:
      "Tell me about the project, the timeline, and what 'done' looks like.",
    submit: "> send_message()",
    sending: "sending…",
    successLine1: "> message_sent.",
    successLine2: "expect_reply within 24h. or email",
    errorRequired: "Required.",
    errorEmail: "Invalid email.",
    errorMinlength: (n: number) => `At least ${n} chars.`,
    errorMaxlength: (n: number) => `Max ${n} chars.`,
    errorInvalid: "Invalid.",
    errorFixFields: "Please fix the highlighted fields.",
    errorRateLimited: "Too many requests. Try again in a few minutes.",
    errorInvalidInput: "Form data was rejected by the server.",
    errorMailerUnavailable: "Email service unavailable. Please email me directly.",
    errorSendFailed: "Could not send. Please email me directly.",
    errorNetwork: "Network error. Please try again.",
  },
  projectCard: {
    problem: "PROBLEM",
    arch: "ARCH",
    infra: "INFRA",
    outcomes: "OUTCOMES",
    caseLabel: (i: number) => `case · 0${i}`,
    live: "live",
    repo: "repo",
    caseStudy: "case_study",
    techStackAriaLabel: "Tech stack",
  },
};

export type AppTranslations = typeof en;
