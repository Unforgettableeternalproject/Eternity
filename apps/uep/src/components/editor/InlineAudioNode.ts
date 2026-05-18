import { Node, mergeAttributes } from '@tiptap/core';

export interface InlineAudioOptions {
  HTMLAttributes: Record<string, unknown>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    inlineAudio: {
      setInlineAudio: (attrs: { src: string; label?: string }) => ReturnType;
    };
  }
}

const InlineAudioNode = Node.create<InlineAudioOptions>({
  name: 'inlineAudio',
  group: 'block',
  atom: true,

  addOptions() {
    return { HTMLAttributes: {} };
  },

  addAttributes() {
    return {
      src: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-src') || '',
        renderHTML: (attrs) => ({ 'data-src': attrs.src }),
      },
      label: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-label') || '',
        renderHTML: (attrs) => ({ 'data-label': attrs.label }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-role="audio-player"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        'data-role': 'audio-player',
        class: 'tiptap-inline-audio',
      }),
    ];
  },

  addCommands() {
    return {
      setInlineAudio:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs,
          }),
    };
  },
});

export default InlineAudioNode;
