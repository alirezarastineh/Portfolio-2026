export interface SocialLink {
  label: string;
  href: string;
  icon: "github" | "linkedin" | "mail" | "twitter";
}

export interface CtaLink {
  label: string;
  href: string;
}

export interface Profile {
  name: string;
  handle: string;
  role: string;
  location: string;
  heroHeadline: string;
  heroSubheadline: string;
  primaryCta: CtaLink;
  secondaryCta: CtaLink;
  socials: SocialLink[];
  contactEmail: string;
}

export const profile: Profile = {
  name: "Alireza Rastineh",
  handle: "@alirezarastineh",
  role: "Full Stack AI Software Engineer",
  location: "Remote",
  heroHeadline: "Full Stack Engineering Meets AI Intelligence.",
  heroSubheadline:
    "Bridging reliable cloud infrastructure and cutting-edge machine learning to deliver production-ready applications.",
  primaryCta: {
    label: "View Projects",
    href: "#projects",
  },
  secondaryCta: {
    label: "Get in Touch",
    href: "#contact",
  },
  socials: [
    {
      label: "GitHub",
      href: "https://github.com/alirezarastineh",
      icon: "github",
    },
    {
      label: "LinkedIn",
      href: "https://www.linkedin.com/in/alirezarastineh",
      icon: "linkedin",
    },
    {
      label: "Email",
      href: "mailto:alirezakhalireza@gmail.com",
      icon: "mail",
    },
  ],
  contactEmail: "alirezakhalireza@gmail.com",
};
