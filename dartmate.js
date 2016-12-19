// Parent Divs
var buttonSection;
var scoreSection;
var navSection;
var optionSection;

var displayMode = 0; // 0 - normal | 1 - options

var scoresRow;
var numPlayers = 2;
var numDarts = 3;
var currentDart = 0;
var currentPlayer = 0;
var startScore = 301;
var players = [
    {
        Name: "Player 1",
        Score: startScore,
        ScoreDiv: {},
        HistoryDiv: {},
        Darts: [],
        n: 0

    },
    {
        Name: "Player 2",
        Score: startScore,
        ScoreDiv: {},
        HistoryDiv: {},
        Darts: [],
        n: 0

    }
];
var darts = [];

var throwScoreSection;

function isDouble(dart)
{
    return dart.match(/D/);
}

function isTriple(dart)
{
    return dart.match(/T/);
}

function getScore(dart)
{
    var multiplier = 1;
    if (isTriple(dart))
    {
        multiplier = 3;
    }
    else if (isDouble(dart))
    {
        multiplier = 2;
    }
    return multiplier * parseInt(dart.replace(/\D/g,''), 10);
}


function getLabel(dart)
{
    if (dart == 'D25') return 'BULL';
    if (dart == 'T0') return 'MISS';
    if (isDouble(dart) || isTriple(dart)) return dart;
    return getScore(dart);
}

function toggleOptions()
{
  if (displayMode == 0)
  {
      // Show options
      buttonSection.classList.add('hide');
      scoreSection.classList.add('hide');
      navSection.classList.add('hide');
      optionSection.classList.remove('hide');
  }
  else
  {
    // hide options
    optionSection.classList.add('hide');
    buttonSection.classList.remove('hide');
    scoreSection.classList.remove('hide');
    navSection.classList.remove('hide');
  }
}


// Calc scores from the start, every dart
// Returns last throw score or -1 if busted
function calculateScores()
{
    var dartNum = 0;
    currentPlayer = 0;
    var throwScore;
    var busted = false;
    var throwStartScore;
    var throwStartN;
    var throwFinished = false;

    // Intitialise player score structures
    for (var p = 0; p < numPlayers; p++)
    {
        players[p].Score = startScore;
        players[p].Darts = [];
        players[p].n = 0; // Number of darts thrown
    }

    for (var t = 0; t < currentDart; t++)
    {
        dartNum++; // Current player's dart number (1 -3)

        // if it's a players first dart, or the last player busted
        // then reset the throw score
        if (dartNum == 1 || busted)
        {
            throwScore = 0;
            throwStartScore = players[currentPlayer].Score;
            throwStartN = players[currentPlayer].n;
        }

        var dartScore = getScore(darts[t]);
        players[currentPlayer].Score -= dartScore;
        throwScore += dartScore;
        players[currentPlayer].Darts[players[currentPlayer].n] = darts[t];
        players[currentPlayer].n++;

        busted = (players[currentPlayer].Score < 2);

        if (players[currentPlayer].Score == 0)
        {
            if (!isDouble(darts[t]))
            {
                busted = true;
            }
            else
            {
                alert(players[currentPlayer].Name + ' WINS!');
		            return;
            }
        }

        if (busted)
        {
            // Hard luck, reset back to score at start and move pointer back
            players[currentPlayer].Score = throwStartScore;
            players[currentPlayer].n = throwStartN;
        }

        throwFinished = (dartNum == numDarts || busted);
        if (throwFinished)
        {
            currentPlayer = (currentPlayer + 1) % numPlayers;
            dartNum = 0;
        }
    }

    if (busted) return -1;
    if (!throwFinished) return null;
    return throwScore;
}


function addScoreboardButton(parentRow, buttonType, scoreNumber)
{
        var btn = document.createElement('div');
        btn.Title = buttonType + scoreNumber; // dart
        btn.Id = 'scoreboardButton' + btn.Title;
        btn.innerHTML = '<span>' + getLabel(btn.Title) + '</span>';
        btn.addEventListener('click', function(e){scoreboardClick(e);}, false);
        btn.classList.add('scoreboardButton');
        btn.classList.add((buttonType + 'score').toLowerCase());
        parentRow.appendChild(btn);
	      return btn;
}

function addOptionButton(parentRow)
{
  var btn = document.createElement('div');
  btn.Title = 'Options';
  btn.innerHTML = 'Options';
  btn.addEventListener('click', function(e){optionButtonClick(e);}, false);
  btn.classList.add('optionButton');
  parentRow.appendChild(btn);
return btn;

}

function updateScores()
{
    for (var i = 0; i < numPlayers; i++)
    {
        players[i].ScoreDiv.innerHTML = players[i].Name + ': ' + players[i].Score;

        if (i == currentPlayer)
        {
            players[i].ScoreDiv.innerHTML = '*' + players[i].ScoreDiv.innerHTML;
        }

        players[i].HistoryDiv.innerHTML = players[i].n == 0 ? '-' : '';
        for (var d = 0; d < players[i].n; d++)
        {
            if ((players[i].n - d) <= 12) // SHow last 12 darts only
            {
              players[i].HistoryDiv.innerHTML += (getLabel(players[i].Darts[d]) + ' ');
              if (d % 3 == 2)
              {
                  players[i].HistoryDiv.innerHTML += ' - ';
              }
            }
        }

    }
}

function drawThrowScore()
{
	throwScoreSection = document.createElement('div');
  document.body.appendChild(throwScoreSection);
  hideThrowScore();
}

function displayThrowScore(score)
{
  throwScoreSection.innerHTML = score;
  throwScoreSection.className ='';
  throwScoreSection.classList.add('throwScoreShow');
}

function hideThrowScore()
{
  throwScoreSection.className ='';
  throwScoreSection.classList.add('throwScore');
}


function drawScores()
{
  scoreSection = document.createElement('div');
  document.body.appendChild(scoreSection);


    for (var i = 0; i < numPlayers; i++)
    {
        var playerScoreSection = document.createElement('div');
        playerScoreSection.classList.add('scoreSection');
        scoreSection.appendChild(playerScoreSection);
        playerScoreSection.innerHTML = players[i].Name + ': ' + players[i].Score;
        players[i].ScoreDiv = playerScoreSection;

        var historySection = document.createElement('div');
        historySection.classList.add('historySection');
        historySection.innerHTML = '-';
        scoreSection.appendChild(historySection);
        players[i].HistoryDiv = historySection;
    }
    updateScores();

    navSection = document.createElement('div');
    document.body.appendChild(navSection);

    var backButton = document.createElement('div');
    backButton.classList.add('backButton');
    backButton.addEventListener('click', function(e){goBack(e);}, false);
    backButton.innerHTML = '<< back';
    navSection.appendChild(backButton);

    var forwardButton = document.createElement('div');
    forwardButton.classList.add('forwardButton');
    forwardButton.addEventListener('click', function(e){goForward(e);}, false);
    forwardButton.innerHTML = 'forward >>';
    navSection.appendChild(forwardButton);

    updateScores();

}

function goBack()
{
    if (currentDart > 0)
    {
        currentDart --;
        calculateScores();
        updateScores();
    }
}

function goForward()
{
    if (currentDart < darts.length)
    {
        currentDart ++;
        calculateScores();
        updateScores();
    }
}


function drawOptions()
{
  optionSection = document.createElement('div');
  optionSection.classList.add('optionSection');
  document.body.appendChild(optionSection);
  optionSection.innerHTML = '<h1>Options</h1>';
}

function drawBoard()
{
    // Create the scoreboard
    var n = 25;

    buttonSection = document.createElement('div');
    buttonSection.classList.add('scoreboard');
    document.body.appendChild(buttonSection);
    var sbSpan = document.createElement('div');
    sbSpan.classList.add('scoreboardSpan');
    buttonSection.appendChild(sbSpan);
    while(n > 0)
    {
        var ns = n.toString();

	if (n == 10)
	{
            sbSpan = document.createElement('div');
            sbSpan.classList.add('scoreboardSpan');
            buttonSection.appendChild(sbSpan);
            addOptionButton(sbSpan);
	}

        var dbl = addScoreboardButton(sbSpan, 'D', ns);
        var sng = addScoreboardButton(sbSpan, 'S', ns);

        if (n < 25)
        {
            addScoreboardButton(sbSpan, 'T', ns);
            n--;
        }
	else
	{
            dbl.classList.add('bull');
            dbl.classList.remove('dscore');
            sng.classList.add('greenbull');
            sng.classList.remove('sscore');
            var miss = addScoreboardButton(sbSpan, 'T', 0);
            miss.classList.add('miss');
            miss.classList.remove('tscore');


            n = 20;
	}

    }

    scoreSection = document.createElement('div');
    scoreSection.Id = 'scoresRow';
    document.body.appendChild(scoreSection);
    drawScores();
    drawThrowScore();
    drawOptions();
}

function updateScore(player, score)
{
    scoresRow.innerHTML = 'Score: ' + score;
}

function optionButtonClick(object)
{
  toggleOptions();
}

// Target click callback
function scoreboardClick(object)
{
    var dart = object.target.Title;
    if (dart == undefined)
    {
        dart = object.target.parentElement.Title
    }
    darts[currentDart] = dart;
    currentDart ++;
    var throwScore = calculateScores();
    updateScores();

    // Show the score throw if the thow is over
    if (throwScore)
    {
      var busted = (throwScore == -1);
        // var throwScore = getScore(darts[currentDart -1])
        //         + getScore(darts[currentDart - 2])
        //         + getScore(darts[currentDart - 3]);
        displayThrowScore(busted ? 'BUST' : throwScore);
    }
    else
    {
      hideThrowScore();
    }
}

(function(){
    window.onload = drawBoard;
    window.onbeforeunload = function() {
      return "Game will be lost if you leave or refresh the page, are you sure?";
      };
})();
