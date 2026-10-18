"""Actual official adapter, synthetic bridge intake, no account connection/sends.

This validates the native extension boundary and durable restart behavior. It
does not claim a real WhatsApp history-sync or account-level end-to-end test.
"""
import asyncio
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

REPO = Path(__file__).resolve().parent.parent
GROUP = '120363000000000001@g.us'
PRIVATE = '120363000000000099@g.us'


def load_plugin():
    source = REPO / 'hermes-plugin/community-archive'
    spec = importlib.util.spec_from_file_location('community_archive', source / '__init__.py',
                                                submodule_search_locations=[str(source)])
    module = importlib.util.module_from_spec(spec)
    sys.modules['community_archive'] = module
    spec.loader.exec_module(module)
    return module


def read_archive():
    from community_archive.tool import handle_archive
    return json.loads(handle_archive({'action': 'count'}))


async def exercise(home):
    plugin = load_plugin()
    from gateway.config import PlatformConfig
    from gateway.platform_registry import PlatformEntry, platform_registry
    from plugins.platforms.whatsapp.adapter import WhatsAppAdapter

    # Seed the real registry as native platform discovery does. The connection
    # is never started; only the real adapter's message-building method executes.
    platform_registry.register(PlatformEntry(name='whatsapp', label='WhatsApp',
                                            adapter_factory=WhatsAppAdapter, check_fn=lambda: True,
                                            source='builtin'))
    class Context:
        def register_tool(self, **kwargs):
            assert kwargs['name'] == 'community_archive'
    plugin.register(Context())
    cfg = PlatformConfig(enabled=True, extra={'group_policy': 'allowlist',
                                             'group_allow_from': [GROUP, PRIVATE],
                                             'require_mention': True})
    adapter = platform_registry.get('whatsapp').adapter_factory(cfg)
    assert adapter._tachles_passive_archive
    data = {'chatId': GROUP, 'isGroup': True, 'messageId': 'native-unmentioned',
            'senderId': '972500000001@s.whatsapp.net', 'senderName': 'דנה',
            'body': 'מחר תפילה ב־07:00', 'timestamp': 1700000000}
    # No mention: the native method returns no event, so no model turn starts.
    assert await adapter._build_message_event(data) is None
    assert await adapter._build_message_event(data) is None
    assert await adapter._build_message_event({**data, 'chatId': PRIVATE, 'messageId': 'private'}) is None
    result = read_archive()
    assert result['ok'] and result['matched_messages'] == 1, result
    assert result['evidence_sample'][0]['provenance']['capture_source'] == 'passive_bridge'
    # A genuinely fresh Python process must find the same retained record.
    restarted = subprocess.run([sys.executable, __file__, '--read'], capture_output=True,
                               text=True, encoding='utf-8', timeout=60, check=True)
    assert json.loads(restarted.stdout)['matched_messages'] == 1
    policy_file = home / 'community/archive-policy.json'
    policy = json.loads(policy_file.read_text(encoding='utf-8'))
    policy['capture']['enabled'] = False
    policy_file.write_text(json.dumps(policy), encoding='utf-8')
    assert await adapter._build_message_event({**data, 'messageId': 'paused'}) is None
    assert read_archive()['matched_messages'] == 1
    return {'actualOfficialAdapter': True, 'nativeRegistryComposition': True,
            'unmentionedTextRetained': True, 'nativeMentionFilterPreserved': True,
            'deduplicated': True, 'privateGroupExcluded': True,
            'durableAcrossProcessRestart': True, 'disableWithoutRestart': True,
            'accountConnectionTested': False, 'messagesSent': 0}


def main():
    if '--read' in sys.argv:
        load_plugin()
        print(json.dumps(read_archive()))
        return
    with tempfile.TemporaryDirectory(prefix='tachles-observer-native-') as directory:
        home = Path(directory)
        os.environ['HERMES_HOME'] = str(home)
        for key in list(os.environ):
            if key.startswith('WHATSAPP_') or key == 'HERMES_PROFILE':
                os.environ.pop(key)
        (home / 'config.yaml').write_text('{}\n', encoding='utf-8')
        (home / 'community').mkdir()
        (home / 'community/archive-policy.json').write_text(json.dumps({
            'version': 1, 'capture': {'enabled': True}, 'groups': [{'id': GROUP, 'name': 'קהילת בדיקה'}]
        }), encoding='utf-8')
        result = asyncio.run(exercise(home))
    target = REPO / '.artifacts/makom/observer-native.json'
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(result, indent=2), encoding='utf-8')
    print(json.dumps(result))


if __name__ == '__main__':
    main()
