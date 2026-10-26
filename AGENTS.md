# Writing rules

- Never apologize or use defensive framing. State problems, corrections, and actions directly.
- Include only information necessary for the reader to understand the project or complete the current task.
- Lead with the purpose, result, or next action. Use plain language and concrete examples.
- Open the README by defining the project and its benefit. Introduce domain examples after that definition.
- Explain the motivation before the mechanisms: client correctness depends on assumptions about independently evolving external APIs. Keep detailed integration instructions in the usage guide.
- Document consumer installation from npm, as `bun add zklean@0.1.0 httpv@0.1.0`. Never point installation at commit hashes, CI artifacts or packed tarballs. Git dependencies and repository credentials belong only in contributor instructions.
- Omit development history, unsolicited project-status commentary, version announcements, and implementation inventories unless the task requires them.
- Explain dependencies and internal mechanisms only when the reader needs them to make a decision or perform an action.
- State relevant requirements and limitations directly. Keep instructions accurate; do not hide prerequisites or claim that an unavailable workflow works.
- Keep the README to purpose, installation, a runnable example, the practical workflow, a short "How it works" section on the architecture, and the trust model. Put detailed protocol and contributor material in dedicated documentation.
- Write for developers new to formal verification and cryptographic proofs. Explain those concepts separately before using them as shared vocabulary.
- Describe security through the client–server trust boundary: what clients verify and what server behavior they must still trust. Keep the README's security section to one paragraph of at most three sentences.
- Import ZKLean only through its public package exports. Keep certificate generation out of the HTTPV runtime; only offline example and fixture scripts may invoke the installed CLI.
- Apply [GOV.UK's clear language guidance](https://guidance.publishing.service.gov.uk/writing-to-gov-uk-standards/writing-guidelines/clear-language/), its [structure guidance](https://guidance.publishing.service.gov.uk/writing-to-gov-uk-standards/writing-guidelines/clear-structure/), and [Google's audience guidance](https://developers.google.com/tech-writing/one/audience): explain terms on first use, put useful information first, and remove repetition.
