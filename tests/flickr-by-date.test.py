"""Checks the OAuth signing in scripts/flickr_by_date.py against the RFC 5849 example."""
import importlib.util
import pathlib
import unittest

spec = importlib.util.spec_from_file_location(
    "flickr_by_date", pathlib.Path(__file__).resolve().parents[1] / "scripts" / "flickr_by_date.py")
fbd = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fbd)


class OAuthSignature(unittest.TestCase):
    def test_rfc5849_example(self):
        # The photos.example.net request from the OAuth 1.0 spec.
        params = {
            "file": "vacation.jpg", "size": "original",
            "oauth_consumer_key": "dpf43f3p2l4k3l03", "oauth_token": "nnch734d00sl2jdk",
            "oauth_signature_method": "HMAC-SHA1", "oauth_timestamp": "1191242096",
            "oauth_nonce": "kllo9940pd9333jh", "oauth_version": "1.0",
        }
        sig = fbd.oauth_signature("GET", "http://photos.example.net/photos", params,
                                  "kd94hf93k423kf44", "pfkkdhi9sl3r4s00")
        self.assertEqual(sig, "tR3+Ty81lMeYAr/Fid0kMTYa/WM=")


if __name__ == "__main__":
    unittest.main()
