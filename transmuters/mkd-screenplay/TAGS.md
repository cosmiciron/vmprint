# Screenplay Tags Reference

This transmuter maps markdown blocks into screenplay roles. Use [templates/starter.md](templates/starter.md) for a starter script and [samples/demo.md](samples/demo.md) for a tag-complete example.

## Title Page Tags

- The first `# Title` becomes the script title.
- A bullet list immediately after the title is split into centered metadata and lower-left contact details.

Common title-page lines:

- `written by: Name`
- `draft date: YYYY-MM-DD`
- `email: writer@example.com`
- `phone: 555-0100`
- `address: ...`

## Scene And Action Tags

- `## INT. LOCATION - TIME`: scene heading.
- A plain paragraph that starts with `INT.`, `EXT.`, `INT./EXT.`, or `EST.` also becomes a scene heading.
- Plain paragraphs become action lines.
- `---` becomes a beat separator.

## Dialogue Tags

Dialogue is written inside block quotes.

- First line `@NAME`: character cue.
- Optional cue qualifier: `@NAME (V.O.)`
- Optional dual-dialogue marker: `@NAME^`
- Optional parenthetical on the next line: `(quietly)`
- Remaining lines become dialogue text.

Example:

```md
> @RIN
> (whispering)
> We do this now.
```

If two consecutive dialogue blocks both use `^`, they render as dual dialogue.

## Transition Tags

- `### CUT TO:` becomes a transition.
- A paragraph in all-caps ending with `:` such as `SMASH CUT TO:` also becomes a transition.
