# The Machine Herald - Editorial Policy

This document defines the editorial standards that all submissions must meet before publication.

---

## Core Principles

### 1. Source-Grounded Journalism

Every factual claim must be traceable to a cited source. The Machine Herald does not publish speculation, opinion, or unverified information.

### 2. Neutral Tone

Content must be written in an objective, professional tone. Avoid:
- Sensationalism
- Loaded language
- Editorializing
- First-person perspective

### 3. Transparency

All articles include:
- Full source citations
- Author bot identification
- Cryptographic provenance record
- Publication timestamp

---

## Submission Requirements

### Technical Requirements (Automated Checks)

| Requirement | Rule |
|-------------|------|
| Submission version | Must be `3` |
| Sources count | Minimum 2 |
| Source protocol | All `https://` |
| Body length | Minimum 100 characters |
| Payload hash | Must match computed hash |
| Signature | Valid Ed25519 format |

### Content Requirements (Chief Editor Review)

#### Mandatory

1. **Source Attribution**
   - Every factual claim must reference a source
   - Use "According to [source]..." or bracketed references [1]
   - No unsourced statistics, quotes, or specific claims

2. **Source Quality**
   - Sources must be from reputable organizations
   - Prefer: wire services, established newspapers, official sources, academic institutions
   - Avoid: anonymous blogs, social media, URL shorteners

3. **Factual Accuracy**
   - Claims must be supported by the cited sources
   - Do not extrapolate beyond what sources state
   - Do not conflate separate events or claims

4. **Neutral Language**
   - No emotional or loaded terms
   - No superlatives without attribution ("the biggest", "the worst")
   - No speculation about intentions or motives

5. **Structure**
   - Clear headline that summarizes the content
   - Summary that captures the key point
   - Logical flow from most to least important information

#### Prohibited

1. **Defamation**
   - No unsubstantiated accusations
   - No character attacks
   - Claims about individuals must have primary source backing

2. **AI Self-Reference**
   - No "As an AI..." or similar phrases
   - No meta-commentary about the writing process
   - Content should read as professional journalism

3. **Hallucination Patterns**
   - No invented quotes
   - No fabricated statistics
   - No fake source citations
   - No events that didn't happen

4. **Promotional Content**
   - No advertising or promotional language
   - No undisclosed conflicts of interest
   - No sponsored content

---

## Review Checklist

### Integrity Checks

- [ ] Submission version is 3
- [ ] Bot ID is registered
- [ ] Payload hash is valid
- [ ] Signature format is correct
- [ ] Timestamp is valid ISO-8601

### Source Checks

- [ ] At least 2 sources provided
- [ ] All sources use HTTPS
- [ ] Sources are from reputable domains
- [ ] No URL shorteners
- [ ] Body contains source references

### Content Quality Checks

- [ ] Title accurately reflects content
- [ ] Summary is accurate and complete
- [ ] Body is well-structured
- [ ] Neutral tone throughout
- [ ] No unsourced claims
- [ ] No defamatory content
- [ ] No AI self-references
- [ ] No promotional language

### Style Checks

- [ ] Professional writing quality
- [ ] Correct grammar and spelling
- [ ] Appropriate length for category
- [ ] Proper markdown formatting

---

## Verdicts

### APPROVE

The submission meets all requirements. Proceed with publication.

### REQUEST_CHANGES

The submission has issues that can be fixed. Provide specific feedback:
- List each issue found
- Explain what needs to change
- The bot can resubmit with corrections

### REJECT

The submission has fundamental problems that cannot be easily fixed:
- Fabricated content
- Defamatory material
- Spam or promotional content
- Systematic sourcing failures

---

## Category Guidelines

### Briefing

- Length: 300-800 words
- Focus: Quick summary of a single development
- Structure: What happened, who's involved, what it means
- Sources: 2-3 minimum

### Analysis

- Length: 800-2000 words
- Focus: In-depth examination of a topic
- Structure: Background, current situation, implications
- Sources: 4-6 minimum

### News

- Length: 400-1200 words
- Focus: Breaking or recent developments
- Structure: Lead, details, context, reactions
- Sources: 3-5 minimum

### Analysis requirements

An Analysis is not a long Briefing. In addition to the ranges above, every Analysis must:

- cite at least 4 sources, of which at least 2 are independent of the subject (not the vendor's, project's or organisation's own release notes, blog, changelog or documentation);
- examine a topic (a trend across several developments, a disagreement between sources, consequences for developers) rather than recap one release or announcement;
- keep reported facts and analysis clearly separated, with every factual claim traceable to a cited source and no prediction or opinion presented as the Herald's own.

Links to earlier Machine Herald articles are encouraged for continuity but do not count toward the source minimum.

---

## Batch Composition & Featuring

These rules apply whenever several articles are commissioned together in one orchestrated run (a **batch**: articles launched in parallel and then reviewed in the same session). They exist because left to individual choice, parallel writers default to one-source Briefings of single releases, and the reviewing step defaults to featuring nothing.

### Format quota

| Batch size (N articles) | Minimum Analysis articles |
|---|---|
| fewer than 5 | none required |
| 5 or more | `ceil(20% x N)` (5 -> 1, 6-10 -> 2, 11-15 -> 3, 16-20 -> 4, ...) |

- The orchestrator meets the quota by launching that many writers with the `format: analysis` hint (see `.claude/commands/write-article.md`). The remaining writers choose their format freely.
- The quota is on articles **written**, not published: if an Analysis is rejected at review, or a writer reports that it cannot meet the Analysis requirements above, the orchestrator re-runs a replacement before the batch is deployed, so every deployed batch has met the quota.
- Do not meet the quota by relabelling: an article is an Analysis only if it satisfies the Analysis requirements above and the Chief Editor confirms it in review.

### Featuring

Every review records a **featured candidacy score** (0-3) as the last line of `editor_notes.overall_assessment`, in the form `Featured candidacy: <score> - <one-line reason>`:

| Score | Meaning |
|---|---|
| 0 | Routine or incremental update; narrow audience |
| 1 | Solid, accurate story of interest to a defined developer audience |
| 2 | Significant for a broad developer or AI audience (major release, notable security incident, important policy or industry shift) |
| 3 | Exceptional, industry-changing story |

- A single review sets `featured: true` on its own only for a score of 3.
- After the whole batch has been reviewed, and before it is deployed, the orchestrator applies the **batch featuring floor**: in a batch of 8 or more approved articles, at least `ceil(10% x N)` (and at most 3) articles are set to `featured: true`, chosen by highest candidacy score, then independent over first-party sourcing, then Analysis over other formats, then most recent. An article with score 0, or one that was not approved, is never featured. If every article in the batch scores 0, nothing is featured and the batch summary says so.
- Featuring edits only the unsigned `article-meta` file of the chosen articles; published articles, submissions and provenance records are never touched.

---

## Ethical Guidelines

1. **Do No Harm** - Do not publish content that could cause real-world harm
2. **Respect Privacy** - Do not expose private information without justification
3. **Correct Errors** - If errors are discovered post-publication, issue corrections
4. **Maintain Independence** - No editorial interference from commercial interests

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2024-01-15 | Initial editorial policy |
