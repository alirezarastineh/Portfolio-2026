export type BentoSpan = "lg" | "tall" | "sm";

export type SkillIcon = "cpu" | "brain-circuit" | "container" | "database";

export interface SkillBentoCard {
  id: string;
  title: string;
  caption: string;
  span: BentoSpan;
  icon: SkillIcon;
  items: string[];
  narrative: string;
}

export const skillBento: SkillBentoCard[] = [
  {
    id: "core-architecture",
    title: "Core Architecture",
    caption: "// frontend + backend + AI",
    span: "lg",
    icon: "cpu",
    items: [
      "TypeScript",
      "Angular",
      "React",
      "Next.js",
      "Node.js",
      "Python",
      "FastAPI",
      "Hono",
      "REST",
      "GraphQL",
      "WebSockets",
    ],
    narrative:
      "I build responsive interfaces in Angular and React that consume high-throughput Python FastAPI backends, seamlessly routing complex user queries to custom-tuned LLMs.",
  },
  {
    id: "ai-ml-stack",
    title: "AI / ML Stack",
    caption: "// database + API + AI",
    span: "tall",
    icon: "brain-circuit",
    items: [
      "PyTorch",
      "LangChain",
      "OpenAI API",
      "Anthropic API",
      "RAG",
      "Vector Search",
      "Pinecone",
      "pgvector",
      "Semantic Caching",
      "Prompt Engineering",
      "Output Parsing",
    ],
    narrative:
      "I leverage PostgreSQL with pgvector extensions alongside Node.js to create lightning-fast Retrieval-Augmented Generation architectures that deliver accurate, context-aware data to the client.",
  },
  {
    id: "devops",
    title: "DevOps & Cloud",
    caption: "// data + ML + cloud",
    span: "sm",
    icon: "container",
    items: ["Docker", "GitHub Actions", "Caddy", "Hetzner", "Linux", "Nginx", "CI/CD"],
    narrative:
      "By orchestrating PyTorch model training pipelines via Docker and GitHub Actions, I ensure that machine learning services deploy cleanly into scalable, highly available cloud environments.",
  },
  {
    id: "data-pipelines",
    title: "Data Pipelines",
    caption: "// storage + streams",
    span: "sm",
    icon: "database",
    items: ["PostgreSQL", "Redis", "Drizzle ORM", "Prisma", "Kafka", "BullMQ"],
    narrative:
      "Typed schemas, vector indexes, and async queues keep inference jobs, embeddings, and user data flowing without bottlenecks.",
  },
];
