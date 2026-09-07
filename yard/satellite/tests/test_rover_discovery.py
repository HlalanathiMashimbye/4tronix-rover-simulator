"""
Finding and checking the rover address.

Setting it meant typing a scheme, a host and a port correctly into a box that
checked only that it began with http. A wrong-but-well-formed address saved
happily and the yard looked broken for a reason the page never gave. That was
met at a demo, which is the worst place to meet it.
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
import rover_discovery as rd


class TestNormalise:
    """The scheme and the port are not decisions anyone should have to get
    right under pressure."""

    @pytest.mark.parametrize('raw,expected', [
        ('curiosity',              'http://curiosity:8523'),
        ('curiosity.local',        'http://curiosity.local:8523'),
        ('192.168.137.32',         'http://192.168.137.32:8523'),
        ('  curiosity.local  ',    'http://curiosity.local:8523'),
        ('host:9000',              'http://host:9000'),
        ('http://x.local:8523/',   'http://x.local:8523'),
        ('https://r.local:1',      'https://r.local:1'),
    ])
    def test_it_fills_in_what_was_left_out(self, raw, expected):
        assert rd.normalise(raw) == expected

    @pytest.mark.parametrize('raw', ['', '   ', None, 'http://', '://', '//x', 'http:///'])
    def test_it_refuses_things_with_no_host(self, raw):
        """Every one of these produced something at some point during writing:
        'http://' became 'http://http:' because the trailing slashes were
        stripped before the scheme was checked, and '//x' became
        'http://:8523//x'. A normaliser that invents an address is worse than
        one that rejects it."""
        assert rd.normalise(raw) == ''


class TestProbe:
    """The check the old validation never did: is a rover actually there."""

    def test_a_rover_answers_with_a_driver(self, monkeypatch):
        monkeypatch.setattr(rd, '_health', lambda url, timeout=None: {'driver': 'RealRoverDriver'})

        ok, detail = rd.probe('http://curiosity.local:8523')

        assert ok is True
        assert detail['driver'] == 'RealRoverDriver'

    def test_nothing_there_is_reported_not_saved(self, monkeypatch):
        monkeypatch.setattr(rd, '_health', lambda url, timeout=None: None)

        ok, detail = rd.probe('http://192.168.1.99:8523')

        assert ok is False
        assert 'rover' in detail

    def test_a_200_from_something_else_is_not_a_rover(self, monkeypatch):
        """A port scan with opinions would call any 200 a success. The rover
        server returns a driver field; nothing else on the yard does."""
        class Resp:
            status_code = 200
            @staticmethod
            def json():
                return {'hello': 'i am a printer'}
        monkeypatch.setattr(rd.requests, 'get', lambda *a, **k: Resp())

        assert rd._health('http://printer.local:8523') is None


class TestDiscover:
    def test_known_names_are_tried_before_any_sweep(self, monkeypatch):
        """A name costs one request and is usually right. Sweeping 254 hosts
        to rediscover curiosity.local would be silly."""
        swept = []
        monkeypatch.setattr(rd, '_port_open', lambda *a, **k: swept.append(1) or False)
        monkeypatch.setattr(rd, '_health',
                            lambda url, timeout=None:
                            {'driver': 'RealRoverDriver'} if 'curiosity' in url else None)

        found = rd.discover()

        assert [f['url'] for f in found] == ['http://curiosity.local:8523']
        assert swept == [], 'must not sweep when a name answered'

    def test_the_sweep_is_the_fallback_when_no_name_answers(self, monkeypatch):
        """The case that caused this: mDNS not resolving, and an operator
        reaching for an address they half remember."""
        monkeypatch.setattr(rd, '_local_subnet',
                            lambda: (__import__('ipaddress').ip_network('192.168.9.0/30'), '192.168.9.1'))
        monkeypatch.setattr(rd, '_port_open', lambda h, **k: h == '192.168.9.2')
        monkeypatch.setattr(rd, '_health',
                            lambda url, timeout=None:
                            {'driver': 'RealRoverDriver'} if '192.168.9.2' in url else None)

        found = rd.discover()

        assert [f['url'] for f in found] == ['http://192.168.9.2:8523']

    def test_the_configured_address_is_tried_first(self, monkeypatch):
        monkeypatch.setattr(rd, '_port_open', lambda *a, **k: False)
        monkeypatch.setattr(rd, '_health',
                            lambda url, timeout=None:
                            {'driver': 'Fake'} if 'saved.local' in url else None)

        found = rd.discover(current_url='http://saved.local:8523')

        assert found[0]['url'] == 'http://saved.local:8523'
