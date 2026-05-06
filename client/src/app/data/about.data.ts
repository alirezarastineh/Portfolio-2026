export interface TerminalLine {
  prompt: string;
  command: string;
  output: string | string[];
}

export const philosophy = `Building AI applications in a Jupyter notebook is easy; keeping them stable in production is hard. My engineering philosophy centers on defensive AI integration. I treat language models as powerful but unpredictable microservices. By implementing strict semantic routing, output parsing, and automated fallback mechanisms, I actively mitigate hallucinations and enforce reliable data structures. I prioritize the user experience by streaming tokens to the frontend to mask latency, while simultaneously optimizing prompt payloads and leveraging semantic caching to keep API inference costs strictly under control. I don't just write prompts; I engineer resilient, full-stack systems around them.`;

export const terminalPrompt = "user@portfolio:~$";

export const terminalLines: TerminalLine[] = [
  {
    prompt: terminalPrompt,
    command: "whoami",
    output: "Alireza Rastineh — Full Stack AI Software Engineer",
  },
  {
    prompt: terminalPrompt,
    command: "cat philosophy.txt",
    output: philosophy,
  },
  {
    prompt: terminalPrompt,
    command: "ls skills/",
    output: [
      "core-architecture/   ai-ml-stack/   devops/   data-pipelines/",
    ],
  },
  {
    prompt: terminalPrompt,
    command: "cat contact.txt",
    output:
      "Open to senior full-stack and AI engineering roles. Reach out via the contact form below or email directly.",
  },
];
