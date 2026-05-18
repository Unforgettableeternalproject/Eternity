import { Node, mergeAttributes } from '@tiptap/core';

export interface UepDialogueOptions {
  HTMLAttributes: Record<string, unknown>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    uepDialogue: {
      setUepDialogue: (attrs?: { side?: 'left' | 'right' }) => ReturnType;
      toggleUepDialogue: () => ReturnType;
      unsetUepDialogue: () => ReturnType;
    };
  }
}

const UepDialogueNode = Node.create<UepDialogueOptions>({
  name: 'uepDialogue',
  group: 'block',
  content: 'inline*',

  addOptions() {
    return { HTMLAttributes: {} };
  },

  addAttributes() {
    return {
      side: {
        default: 'left',
        parseHTML: (element) => element.getAttribute('data-side') || 'left',
        renderHTML: (attributes) => ({ 'data-side': attributes.side }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-role="uep"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        'data-role': 'uep',
        class: 'tiptap-uep-dialogue',
      }),
      0,
    ];
  },

  addCommands() {
    return {
      setUepDialogue:
        (attrs) =>
        ({ commands }) =>
          commands.setNode(this.name, attrs),
      toggleUepDialogue:
        () =>
        ({ commands }) =>
          commands.toggleNode(this.name, 'paragraph'),
      unsetUepDialogue:
        () =>
        ({ commands }) =>
          commands.setNode('paragraph'),
    };
  },

  addKeyboardShortcuts() {
    return {
      'Mod-Shift-u': () => this.editor.commands.toggleUepDialogue(),
    };
  },
});

export default UepDialogueNode;
