import { extractAssetKeysFromContentBlock } from './assets.ts';

function assertDeepEqual(actual, expected, label) {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(
      `${label}\nExpected: ${expectedJson}\nActual:   ${actualJson}`
    );
  }
}

{
  const block = {
    type: 'rich-text',
    content: JSON.stringify({
      html: '<p><img src="http://localhost:8788/api/assets/images/echoes-home.png"></p>',
    }),
  };

  assertDeepEqual(
    [...extractAssetKeysFromContentBlock(block)],
    ['images/echoes-home.png'],
    'extracts assets from homepage rich-text JSON html without JSON escape suffix'
  );
}

{
  const block = {
    type: 'rich_text',
    content:
      '<div data-role="audio-player" data-src="https://example.com/api/assets/audio/theme.mp3" data-label="Theme"></div>',
  };

  assertDeepEqual(
    [...extractAssetKeysFromContentBlock(block)],
    ['audio/theme.mp3'],
    'extracts inline audio assets from rich text html'
  );
}
