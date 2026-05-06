export interface ProjectLinks {
  live?: string;
  repo?: string;
  caseStudy?: string;
}

export interface Project {
  slug: string;
  name: string;
  descriptor: string;
  hook: string;
  problem: string;
  aiArchitecture: string;
  fullStackInfra: string;
  outcomes: string[];
  stack: string[];
  image: string;
  links: ProjectLinks;
}

export const projects: Project[] = [
  {
    slug: "project-one",
    name: "TODO: Project One",
    descriptor: "TODO: Five-word descriptor",
    hook: "TODO: One-sentence hook describing exactly what the product does and who it helps.",
    problem:
      "TODO: Pain point that existed before this software. Quantify the cost (hours, dollars, headcount).",
    aiArchitecture:
      "TODO: Models and AI pipelines used. Name the LLM, the orchestration framework, the retrieval strategy.",
    fullStackInfra:
      "TODO: How the AI is served and consumed. Backend framework, database, frontend stack, deployment target.",
    outcomes: [
      "TODO: Concrete metric #1 (e.g. reduced X by Y%)",
      "TODO: Concrete metric #2 (latency, throughput, cost)",
      "TODO: Concrete metric #3 (adoption, retention, savings)",
    ],
    stack: ["TypeScript", "Python", "FastAPI", "Postgres"],
    image: "/projects/project-one.svg",
    links: {
      live: "",
      repo: "",
      caseStudy: "",
    },
  },
  {
    slug: "project-two",
    name: "TODO: Project Two",
    descriptor: "TODO: Five-word descriptor",
    hook: "TODO: One-sentence hook.",
    problem: "TODO: Business problem.",
    aiArchitecture: "TODO: AI architecture.",
    fullStackInfra: "TODO: Infrastructure.",
    outcomes: ["TODO: Metric #1", "TODO: Metric #2", "TODO: Metric #3"],
    stack: ["Angular", "Node.js", "Redis"],
    image: "/projects/project-two.svg",
    links: {
      live: "",
      repo: "",
      caseStudy: "",
    },
  },
  {
    slug: "project-three",
    name: "TODO: Project Three",
    descriptor: "TODO: Five-word descriptor",
    hook: "TODO: One-sentence hook.",
    problem: "TODO: Business problem.",
    aiArchitecture: "TODO: AI architecture.",
    fullStackInfra: "TODO: Infrastructure.",
    outcomes: ["TODO: Metric #1", "TODO: Metric #2", "TODO: Metric #3"],
    stack: ["React", "PyTorch", "Docker"],
    image: "/projects/project-three.svg",
    links: {
      live: "",
      repo: "",
      caseStudy: "",
    },
  },
];
